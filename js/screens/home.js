import { auth, db, functions, GOOGLE_MAPS_API_KEY } from '../firebase-config.js';
import badgeService from './badge-service.js';
import { 
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  setDoc,
  Timestamp,
  arrayUnion,
    arrayRemove,
  writeBatch,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const storage = getStorage();

class HomeManager {
  constructor() {
    this.els = {};
    this.currentUser = null;
    this.userData = null;


    this.unsubscribe = null;
    this.walletUnsubscribe = null;
    this.userRole = '';
    this.userCountry = '';
    this.userState = '';
    this.userKennel = '';
	// ADD THESE TWO LINES for cropper support:
  this.cropper = null;
  this.cropperModal = null;
  this.kennelWallets = new Map(); // Cache kennel wallets
this.currentKennelWallet = null; // Currently selected kennel
    
    // Badge tracking
    this.unreadMap = {
      view_requests: 0,
      new_kennel_requests: 0,
      payment: 0,
      run_payment: 0,
      chat: 0
    };
    
    // Store all unsubscribe functions for cleanup
    this.unsubscribers = [];
	
	// ADD THIS: Cache for dialog data
    this.cache = {
      countries: null,
      states: {}, // key: country
      kennels: {}, // key: country_state
      users: null,
      roles: {},
      adminKennels: null
    };
	
	
	    // ADD THIS: Native audio sound system for request notifications
    this.audioEnabled = false;
    this.audioContext = null;
    this.sounds = {
      view_requests: null,      // Will load new_chat_request.mp3
      new_kennel_requests: null  // Will load new_kennel_request.mp3
    };
    this.lastPlayedCounts = {
      view_requests: 0,
      new_kennel_requests: 0
    };
    this.isPlaying = false;
    this.audioQueue = [];	
	 // ADD THIS: Track badge counts per kennel for Tier 2
    this.kennelBadgeCounts = new Map();
    
    this.init();
  }

  init() {
    this.cacheElements();
    this.setupEventListeners();
    this.checkAuthState();
    
    // Initialize shared badge service
    badgeService.init().then(() => {
      console.log('Badge service initialized');
    });
	      // Initialize native audio system
    this.initAudioSystem();

  }
  
    initAudioSystem() {
    // Check for AudioContext support
    if (!window.AudioContext && !window.webkitAudioContext) {
      console.log('Web Audio API not supported');
      return;
    }
    
    // Create audio context (will be resumed on user interaction)
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Pre-load sound files
    this.preloadSounds();
    
    // Unlock audio on first interaction (required by browsers)
    const unlockAudio = async () => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      if (!this.audioEnabled) {
        this.audioEnabled = true;
        console.log('🔊 Native audio system unlocked');
        this.processAudioQueue();
      }
    };
    
    ['click', 'touchstart', 'keydown'].forEach(event => {
      document.addEventListener(event, unlockAudio, { once: true, capture: true });
    });
  }
  
  preloadSounds() {
    // Define sound URLs - adjust paths to match your actual sound file locations
    const soundUrls = {
      view_requests: './sounds/new_chat_request.mp3',
      new_kennel_requests: './sounds/new_kennel_request.mp3'
    };
    
    // Preload each sound
    Object.keys(soundUrls).forEach(type => {
      const audio = new Audio();
      audio.src = soundUrls[type];
      audio.preload = 'auto';
      
      // Store for later use
      this.sounds[type] = audio;
      
      audio.onerror = () => {
        console.warn(`Failed to load sound: ${soundUrls[type]}`);
      };
    });
  }

	// ADD THIS NEW METHOD to check for Tier 2 across all kennels
hasTier2Access() {
  // Check main role
  if (this.userRole === 'Tier 2' || this.userRole === 'Tier 1') {
    return true;
  }
  // Check otherKennels
  const others = this.userData?.otherKennels || [];
  return others.some(k => k.role === 'Tier 2');
}

// ADD THIS NEW METHOD to check for Tier 1 access
hasTier1Access() {
  return this.userRole === 'Tier 1';
}

  

  playSound(type, priority = false) {
    if (!this.audioEnabled || !this.sounds[type]) return;
    
    const audio = this.sounds[type];
    
    // Clone audio to allow overlapping sounds if needed
    const playAudio = audio.cloneNode();
    
    if (priority) {
      // Stop all current sounds and play immediately
      this.stopAllSounds();
      playAudio.play().catch(e => console.log('Audio play failed:', e));
    } else {
      if (this.isPlaying) {
        this.audioQueue.push(type);
      } else {
        this.isPlaying = true;
        playAudio.play().catch(e => console.log('Audio play failed:', e));
        playAudio.onended = () => {
          this.isPlaying = false;
          this.processAudioQueue();
        };
      }
    }
  }
  
  stopAllSounds() {
    // Stop all currently playing sounds
    Object.values(this.sounds).forEach(audio => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    this.isPlaying = false;
    this.audioQueue = [];
  }

  processAudioQueue() {
    if (this.audioQueue.length > 0 && !this.isPlaying) {
      const nextType = this.audioQueue.shift();
      this.playSound(nextType);
    }
  }

  playRequestSound(type, count) {
    if (!this.audioEnabled || count === 0) return;
    
    // Only play if count increased (new requests came in)
    const lastCount = this.lastPlayedCounts[type] || 0;
    if (count <= lastCount) {
      this.lastPlayedCounts[type] = count;
      return;
    }
    
    const newRequests = count - lastCount;
    this.lastPlayedCounts[type] = count;
    
    // Play native sound once for the notification
    this.playSound(type, true);
  }

  cacheElements() {
const ids = [
  'tvWelcome', 'tvKennel', 'tvState', 'tvCountry', 'tvSubscription',
  'tvNextRunTitle', 'tvNextRunDetails', 'tvNextRunSubDetails',
  'btnFindRun', 'btnEvents', 'btnSongs',
  'btnAddKennel', 'btnViewRequests', 'btnNewKennelRequests', 'overflowBtn', 'overflowMenu',
  'badge', 'profileImg', 'actionGrid',
  // Wallet elements
  'walletSection', 'tvWalletBalance', 'btnRefreshBalance',
  // Kennel wallet elements
  'kennelWalletSection', 'tvKennelWalletBalance', 'selKennelWallet'
];
    
    ids.forEach(id => {
      this.els[id] = document.getElementById(id);
    });
  }

  setupEventListeners() {
    // Overflow menu toggle
    this.els.overflowBtn.onclick = (e) => {
      e.stopPropagation();
      this.els.overflowMenu.classList.toggle('hidden');
    };

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#overflowBtn') && !e.target.closest('#overflowMenu')) {
        this.els.overflowMenu.classList.add('hidden');
      }
    });

    // Action buttons
    this.els.btnFindRun.onclick = () => this.navigateTo('runs');
    this.els.btnEvents.onclick = () => this.navigateTo('events');
    this.els.btnSongs.onclick = () => this.navigateTo('songs');
    this.els.btnAddKennel.onclick = () => this.showAddKennelDialog();
    this.els.btnViewRequests.onclick = () => this.handleViewRequestsClick();
	this.els.btnNewKennelRequests.onclick = () => this.showNewKennelRequestsDialog();
    

    // Refresh balance button
    if (this.els.btnRefreshBalance) {
      this.els.btnRefreshBalance.onclick = () => this.refreshWalletBalance();
    }
	
	    // Refresh next run (optional - if you want a manual refresh)
    if (this.els.tvNextRunTitle) {
      this.els.tvNextRunTitle.onclick = () => this.loadNextRun();
    }

    // Overflow menu items
    document.getElementById('menuAddKennel').onclick = (e) => {
      e.preventDefault();
      this.els.overflowMenu.classList.add('hidden');
      this.showAddKennelDialog();
    };
    document.getElementById('menuViewRequests').onclick = (e) => {
      e.preventDefault();
      this.els.overflowMenu.classList.add('hidden');
      this.unreadMap.view_requests = 0;
      this.recalcTotal();
      this.handleViewRequestsClick();
    };
    document.getElementById('menuKennelAdmin').onclick = (e) => {
      e.preventDefault();
      this.els.overflowMenu.classList.add('hidden');
      this.showKennelAdminDialog();
    };
    document.getElementById('menuNewKennelRequests').onclick = (e) => {
      e.preventDefault();
      this.els.overflowMenu.classList.add('hidden');
      this.unreadMap.new_kennel_requests = 0;
      this.recalcTotal();
      this.showNewKennelRequestsDialog();
    };
    document.getElementById('menuUsersList').onclick = (e) => {
      e.preventDefault();
      this.els.overflowMenu.classList.add('hidden');
      this.showUsersListDialog();
    };
     document.getElementById('menuPaymentList').onclick = (e) => {
      e.preventDefault();
      this.els.overflowMenu.classList.add('hidden');
      this.showPaymentListDialog();
    };

    // Bottom nav
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
      item.onclick = (e) => {
        e.preventDefault();
        const screen = item.dataset.screen;
        this.handleBottomNav(screen);
      };
    });
// Profile click - opens image picker with cropping
this.els.profileImg.onclick = () => this.showProfileImageOptions();
  
  }




// NEW: Show options for profile image (change picture or view)
showProfileImageOptions() {
  const options = document.createElement('div');
  options.className = 'more-dialog';
  options.innerHTML = `
    <div class="more-dialog-content" style="max-width: 300px;">
      <h3>Profile Picture</h3>
      <button class="more-option" id="btnChangePic">Change Picture</button>
      <button class="more-option" id="btnViewPic">View Picture</button>
      <button class="more-cancel">Cancel</button>
    </div>
  `;
  
  document.body.appendChild(options);
  
  options.querySelector('#btnChangePic').onclick = () => {
    options.remove();
    this.openImageCropper(); // This now uses the cropper from personal.js
  };
  
  options.querySelector('#btnViewPic').onclick = () => {
    options.remove();
    this.viewProfileImage();
  };
  
  options.querySelector('.more-cancel').onclick = () => options.remove();
  options.onclick = (e) => {
    if (e.target === options) options.remove();
  };
}

// NEW: Open file picker and initialize cropper (FROM personal.js)
openImageCropper() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      this.handleFileSelect(file); // Uses cropper logic from personal.js
    }
  };
  input.click();
}

// NEW: Handle file selection and open cropper modal (FROM personal.js)
handleFileSelect(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file');
    return;
  }

  // Read file and show cropper
  const reader = new FileReader();
  reader.onload = (e) => {
    this.openCropperModal(e.target.result);
  };
  reader.readAsDataURL(file);
}

// NEW: Create and show cropper modal (FROM personal.js)
openCropperModal(imageSrc) {
  // Create modal if it doesn't exist
  if (!this.cropperModal) {
    this.createCropperModal();
  }
  
  this.els.cropperImage.src = imageSrc;
  this.els.cropperModal.classList.add('active');
  
  // Initialize cropper after image loads
  this.els.cropperImage.onload = () => {
    this.initCropper();
  };
}

// NEW: Create cropper modal HTML structure (FROM personal.js)
createCropperModal() {
  const modal = document.createElement('div');
  modal.id = 'cropperModal';
  modal.className = 'cropper-modal';
  modal.innerHTML = `
    <div class="cropper-container">
      <div class="cropper-header">
        <h3>Crop Profile Picture</h3>
        <button id="btnCloseCropper" class="close-btn">×</button>
      </div>
      <div class="cropper-body">
        <img id="cropperImage" src="" alt="Crop preview">
      </div>
      <div class="cropper-controls">
        <label>Zoom</label>
        <input type="range" id="zoomSlider" min="0.1" max="3" step="0.1" value="1">
      </div>
      <div class="cropper-footer">
        <button id="btnCancelCrop" class="btn-secondary">Cancel</button>
        <button id="btnConfirmCrop" class="btn-primary">Save</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Cache elements
  this.els.cropperModal = modal;
  this.els.cropperImage = modal.querySelector('#cropperImage');
  this.els.zoomSlider = modal.querySelector('#zoomSlider');
  
  // Event listeners
  modal.querySelector('#btnCloseCropper').onclick = () => this.closeCropper();
  modal.querySelector('#btnCancelCrop').onclick = () => this.closeCropper();
  modal.querySelector('#btnConfirmCrop').onclick = () => this.confirmCrop();
  
  // Zoom control
  this.els.zoomSlider.addEventListener('input', (e) => {
    if (this.cropper) {
      const ratio = parseFloat(e.target.value);
      this.cropper.zoomTo(ratio);
    }
  });
  
  // Close on overlay click
  modal.onclick = (e) => {
    if (e.target === modal) this.closeCropper();
  };
}

// NEW: Initialize Cropper.js (FROM personal.js)
initCropper() {
  // Destroy existing cropper if any
  if (this.cropper) {
    this.cropper.destroy();
  }

  this.cropper = new Cropper(this.els.cropperImage, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 0.8,
    restore: false,
    guides: false,
    center: true,
    highlight: false,
    cropBoxMovable: true,
    cropBoxResizable: true,
    toggleDragModeOnDblclick: false,
    minCropBoxWidth: 200,
    minCropBoxHeight: 200,
    ready: () => {
      this.els.zoomSlider.value = 1;
    },
    zoom: (event) => {
      const ratio = event.detail.ratio;
      this.els.zoomSlider.value = ratio;
    }
  });
}

// NEW: Close cropper modal (FROM personal.js)
closeCropper() {
  if (this.els.cropperModal) {
    this.els.cropperModal.classList.remove('active');
  }
  if (this.cropper) {
    this.cropper.destroy();
    this.cropper = null;
  }
}

// NEW: Confirm crop and upload (FROM personal.js)
async confirmCrop() {
  if (!this.cropper) return;

  // Show loading state
  this.els.profileImg.style.opacity = '0.5';

  try {
    // Get cropped canvas
    const croppedCanvas = this.cropper.getCroppedCanvas({
      width: 512,
      height: 512,
      minWidth: 200,
      minHeight: 200,
      maxWidth: 1024,
      maxHeight: 1024,
      fillColor: '#fff',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    // Create circular canvas
    const circularCanvas = this.getRoundedCanvas(croppedCanvas);
    
    // Convert to blob
    const blob = await new Promise(resolve => {
      circularCanvas.toBlob(resolve, 'image/jpeg', 0.9);
    });

    // Upload to Firebase Storage
    await this.uploadProfilePicture(blob);
    
    this.closeCropper();
    
  } catch (error) {
    console.error('Error processing image:', error);
    alert('Failed to process image: ' + error.message);
    this.els.profileImg.style.opacity = '1';
  }
}

// NEW: Create circular canvas (FROM personal.js)
getRoundedCanvas(sourceCanvas) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  
  canvas.width = width;
  canvas.height = height;
  
  context.imageSmoothingEnabled = true;
  context.drawImage(sourceCanvas, 0, 0, width, height);
  
  // Create circular mask
  context.globalCompositeOperation = 'destination-in';
  context.beginPath();
  context.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, 2 * Math.PI, true);
  context.fill();
  
  return canvas;
}

// NEW: Upload to Firebase Storage (FROM personal.js)
async uploadProfilePicture(blob) {
  if (!this.currentUser) {
    throw new Error('No user logged in');
  }
  
  const uid = this.currentUser.uid;
  const storageRef = ref(storage, `profilePics/${uid}.jpg`);
  
  try {
    // Upload
    await uploadBytes(storageRef, blob);
    
    // Get download URL
    const downloadURL = await getDownloadURL(storageRef);
    
    // Update user document
    await updateDoc(doc(db, 'users', uid), {
      profilePicUrl: downloadURL
    });
    
    // Update UI
    this.els.profileImg.src = downloadURL;
    this.els.profileImg.style.opacity = '1';
    
    alert('Profile picture updated successfully!');
    
  } catch (error) {
    console.error('Upload error:', error);
    this.els.profileImg.style.opacity = '1';
    throw error;
  }
}

// NEW: View profile image in full size (FROM personal.js)
viewProfileImage() {
  const url = this.userData?.profilePicUrl;
  if (!url) {
    alert('No profile picture set');
    return;
  }
  
  const viewer = document.createElement('div');
  viewer.className = 'more-dialog';
  viewer.innerHTML = `
    <div class="more-dialog-content" style="background: transparent; box-shadow: none;">
      <img src="${url}" style="width: 100%; max-width: 400px; border-radius: 50%; border: 4px solid white;">
      <button class="more-cancel" style="margin-top: 20px; background: white;">Close</button>
    </div>
  `;
  
  document.body.appendChild(viewer);
  viewer.querySelector('.more-cancel').onclick = () => viewer.remove();
  viewer.onclick = (e) => {
    if (e.target === viewer) viewer.remove();
  };
}

  // NEW: Open file picker for image
  openImagePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        this.processAndUploadImage(file);
      }
    };
    input.click();
  }

  // NEW: Process image (resize, crop to circle) and upload
  async processAndUploadImage(file) {
    try {
      // Show loading state
      this.els.profileImg.style.opacity = '0.5';
      
      // Create canvas for image processing
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 512; // Same as Android
      
      canvas.width = size;
      canvas.height = size;
      
      // Load image
      const img = await this.loadImage(file);
      
      // Calculate crop to center square (like Android's createScaledBitmap)
      let sx, sy, sWidth, sHeight;
      if (img.width > img.height) {
        sHeight = img.height;
        sWidth = img.height;
        sx = (img.width - img.height) / 2;
        sy = 0;
      } else {
        sWidth = img.width;
        sHeight = img.width;
        sx = 0;
        sy = (img.height - img.width) / 2;
      }
      
      // Clear canvas
      ctx.clearRect(0, 0, size, size);
      
      // Create circular clip
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      
      // Draw image scaled to fit
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, size, size);
      
      // Convert to blob
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', 0.9);
      });
      
      // Upload to Firebase Storage
      await this.uploadProfilePicture(blob);
      
    } catch (error) {
      console.error('Image processing error:', error);
      alert('Failed to process image: ' + error.message);
      this.els.profileImg.style.opacity = '1';
    }
  }

  // NEW: Load image from file
  loadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // NEW: Upload to Firebase Storage and update user doc
  async uploadProfilePicture(blob) {
    if (!this.currentUser) {
      throw new Error('No user logged in');
    }
    
    const uid = this.currentUser.uid;
    const storageRef = ref(storage, `profilePics/${uid}.jpg`);
    
    try {
      // Upload
      await uploadBytes(storageRef, blob);
      
      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);
      
      // Update user document
      await updateDoc(doc(db, 'users', uid), {
        profilePicUrl: downloadURL
      });
      
      // Update UI
      this.els.profileImg.src = downloadURL;
      this.els.profileImg.style.opacity = '1';
      
      alert('Profile picture updated successfully!');
      
    } catch (error) {
      console.error('Upload error:', error);
      this.els.profileImg.style.opacity = '1';
      throw error;
    }
  }

  // NEW: View profile image in full size
  viewProfileImage() {
    const url = this.userData?.profilePicUrl;
    if (!url) {
      alert('No profile picture set');
      return;
    }
    
    const viewer = document.createElement('div');
    viewer.className = 'more-dialog';
    viewer.innerHTML = `
      <div class="more-dialog-content" style="background: transparent; box-shadow: none;">
        <img src="${url}" style="width: 100%; max-width: 400px; border-radius: 50%; border: 4px solid white;">
        <button class="more-cancel" style="margin-top: 20px; background: white;">Close</button>
      </div>
    `;
    
    document.body.appendChild(viewer);
    viewer.querySelector('.more-cancel').onclick = () => viewer.remove();
    viewer.onclick = (e) => {
      if (e.target === viewer) viewer.remove();
    };
  }

  handleBottomNav(screen) {
    switch(screen) {
      case 'home':
        break;
      case 'runs':
        window.location.href = 'runs.html';
        break;
      case 'trails':
        window.location.href = 'trail.html';
        break;
      case 'chat':
        window.location.href = 'chat.html';
        break;
      case 'more':
        this.showMoreOptions();
        break;
    }
  }

   checkAuthState() {
    // ADD THIS: Check cached auth first to prevent flash
    const lastAuth = sessionStorage.getItem('lastAuthTime');
    const cachedUser = sessionStorage.getItem('cachedUser');
    const now = Date.now();
    
    if (lastAuth && cachedUser && (now - parseInt(lastAuth)) < 300000) {
      // Use cached auth - instant, no Firebase call needed yet
      const userData = JSON.parse(cachedUser);
      this.currentUser = { uid: userData.uid };
      // Still listen for real auth state in background
    }
    
    onAuthStateChanged(auth, (user) => {
      if (user) {
        this.currentUser = user;
        // ADD THIS: Cache the auth
        sessionStorage.setItem('lastAuthTime', Date.now().toString());
        sessionStorage.setItem('cachedUser', JSON.stringify({
          uid: user.uid,
          email: user.email
        }));
        this.loadUserData(user.uid);
      } else {
        // ADD THIS: Clear cache on logout
        sessionStorage.removeItem('lastAuthTime');
        sessionStorage.removeItem('cachedUser');
        window.location.href = 'login.html';
      }
    });
  }

  loadUserData(uid) {
    const userRef = doc(db, 'users', uid);
    
    // ADD THIS: Check for cached user data first
    const cachedUserData = sessionStorage.getItem('userData_' + uid);
    if (cachedUserData) {
      const parsed = JSON.parse(cachedUserData);
      // Apply cached data immediately for instant UI
      this.userData = parsed;
      this.userRole = parsed.role || '';
      this.userCountry = parsed.country || '';
      this.userState = parsed.state || '';
      this.userKennel = parsed.kennel || '';
      this.updateUI();
      this.updateRoleBasedVisibility();
      this.loadNextRun();
      this.startUnreadListeners();
      // ADD THIS: Pre-fetch dialog data in background after UI shows
      setTimeout(() => this.prefetchDialogData(), 100);
    }
    
    this.unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        this.userData = snapshot.data();
        // ADD THIS: Cache user data
        sessionStorage.setItem('userData_' + uid, JSON.stringify(this.userData));
        
        this.userRole = this.userData.role || '';
        this.userCountry = this.userData.country || '';
        this.userState = this.userData.state || '';
        this.userKennel = this.userData.kennel || '';
        
        this.updateUI();
        this.updateRoleBasedVisibility();
        this.loadNextRun();
        this.startUnreadListeners();
		this.loadNextRun();

        // ADD THIS: Pre-fetch after real data loads too
        setTimeout(() => this.prefetchDialogData(), 100);
      } else {
        window.location.href = 'signup.html';
      }
    }, (error) => {
      console.error('Error in user data listener:', error);
      if (error.code === 'permission-denied') {
        alert('Permission denied. Please log in again.');
        this.logout();
      }
    });
  }
  
    // ADD THIS: New method to pre-fetch dialog data
  async prefetchDialogData() {
    if (!this.userRole) return;
    
    // Pre-fetch countries (used by Add Kennel and Kennel Admin dialogs)
    if (!this.cache.countries) {
      try {
        const snap = await getDocs(collection(db, 'locations'));
        this.cache.countries = snap.docs.map(d => d.id).sort();
      } catch (e) {
        console.error('Prefetch countries failed:', e);
      }
    }
    
    // Pre-fetch users list (used by Kennel Admin)
    if (!this.cache.users && (this.userRole === 'Tier 1' || this.userRole === 'Tier 2')) {
      try {
        const usersQuery = query(collection(db, 'users'), orderBy('hashHandle', 'asc'));
        const usersSnap = await getDocs(usersQuery);
        this.cache.users = usersSnap.docs.map(doc => ({
          id: doc.id,
          hashHandle: doc.data().hashHandle || 'Unknown',
          ...doc.data()
        }));
      } catch (e) {
        console.error('Prefetch users failed:', e);
      }
    }
    
    // Pre-fetch admin kennels for Tier 2
    if (this.userRole === 'Tier 2' && !this.cache.adminKennels) {
      this.cache.adminKennels = this.getAdminKennels();
    }
  }

  updateUI() {
    const d = this.userData;
    const handle = d.hashHandle || 'Hasher';
    const desig = d.designation || 'Hasher';

    let welcomeText;
    if (desig.toLowerCase() === 'hasher') {
      welcomeText = `Welcome, ${handle}!`;
    } else if (desig.toLowerCase() === 'grand master') {
      welcomeText = `Welcome, ${handle} (GM)!`;
    } else if (desig.toLowerCase() === 'hash master') {
      welcomeText = `Welcome, ${handle} (HM)!`;
    } else {
      welcomeText = `Welcome, ${handle} (${desig})!`;
    }

    this.els.tvWelcome.textContent = welcomeText;
    this.els.tvKennel.innerHTML = `<strong>Kennel:</strong> ${d.kennel || '-'}`;
    this.els.tvState.innerHTML = `<strong>State:</strong> ${d.state || '-'}`;
    this.els.tvCountry.innerHTML = `<strong>Country:</strong> ${d.country || '-'}`;
    
    // Show wallet for Nigeria users
    if (d.country === 'Nigeria' && this.els.walletSection) {
      this.els.walletSection.style.display = 'flex';
      this.updateWalletDisplay(d.walletBalance || 0);
      this.startWalletListener();
    } else if (this.els.walletSection) {
      this.els.walletSection.style.display = 'none';
    }
	
	    // Show kennel wallet for Tier 1/Tier 2 admins
    this.updateKennelWalletVisibility();
    
    const subscription = d.subscriptionTier || 'Free';
    this.els.tvSubscription.innerHTML = `<strong>Subscription:</strong> ${subscription}`;

    if (d.profilePicUrl) {
      this.els.profileImg.src = d.profilePicUrl;
    }
  }

   updateWalletDisplay(balance) {
    if (this.els.tvWalletBalance) {
      // Make the balance text clickable, keep refresh button separate
      this.els.tvWalletBalance.innerHTML = `
        <span id="walletBalanceText" style="cursor: pointer; text-decoration: underline;">
          <strong>Wallet:</strong> ₦${balance.toLocaleString()}
        </span>
      `;
      
      // Add click handler to the text (not the refresh button)
      const balanceText = this.els.tvWalletBalance.querySelector('#walletBalanceText');
      if (balanceText) {
        balanceText.onclick = (e) => {
          e.stopPropagation(); // Prevent event bubbling
          this.showWalletDetailsDialog();
        };
      }
    }
  }

  showWalletDetailsDialog() {
    // Check if user has wallet data
    if (!this.userData || !this.userData.titanAccountNumber) {
      alert('No wallet found. Please create a wallet first.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
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
      font-family: sans-serif;
    `;
    
    overlay.innerHTML = `
      <div style="
        background: white;
        width: 90%;
        max-width: 400px;
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
          background: #FF6D00;
        ">
          <h2 style="margin: 0; font-size: 18px; color: white;">Wallet Details</h2>
          <button id="close-wallet-details" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
            color: white;
          ">×</button>
        </div>
        
        <div style="
          padding: 24px 20px;
        ">
          <!-- Account Details -->
          <div style="margin-bottom: 20px;">
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 0;
              border-bottom: 1px solid #f0f0f0;
            ">
              <span style="font-weight: bold; color: #333;">Acc No:</span>
              <span style="color: #666; font-family: monospace; font-size: 16px;">${this.userData.titanAccountNumber || '-'}</span>
            </div>
            
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 0;
              border-bottom: 1px solid #f0f0f0;
            ">
              <span style="font-weight: bold; color: #333;">Acc Name:</span>
              <span style="color: #666;">${this.userData.titanAccountName || '-'}</span>
            </div>
            
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 0;
            ">
              <span style="font-weight: bold; color: #333;">Bank:</span>
              <span style="color: #666;">${this.userData.titanBankName || '-'}</span>
            </div>
          </div>
          
          <!-- Funding Instructions -->
          <div style="
            background: #FFF3E0;
            padding: 16px;
            border-radius: 8px;
            border-left: 4px solid #FF6D00;
          ">
            <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #E65100; font-weight: 600;">
              How to Fund Your Wallet
            </h3>
            <ol style="margin: 0; padding-left: 20px; color: #666; font-size: 14px; line-height: 1.6;">
              <li>Transfer money to the account details above using your bank app or USSD</li>
              <li>Click the refresh button (↻) next to your balance</li>
              <li>Your wallet will be credited automatically within 2-3 minutes</li>
            </ol>
          </div>
          
          <!-- Current Balance Display -->
          <div style="
            margin-top: 20px;
            padding: 16px;
            background: #f5f5f5;
            border-radius: 8px;
            text-align: center;
          ">
            <div style="font-size: 12px; color: #999; margin-bottom: 4px;">Current Balance</div>
            <div style="font-size: 24px; font-weight: bold; color: #4CAF50;">
              ₦${(this.userData.walletBalance || 0).toLocaleString()}
            </div>
          </div>
        </div>
        
        <div style="
          padding: 16px 20px;
          border-top: 1px solid #e0e0e0;
          display: flex;
          justify-content: center;
        ">
          <button id="btn-close-wallet" style="
            padding: 12px 32px;
            border: none;
            background: #FF6D00;
            color: white;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
          ">Close</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Close handlers
    overlay.querySelector('#close-wallet-details').onclick = () => overlay.remove();
    overlay.querySelector('#btn-close-wallet').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  }

  
  startWalletListener() {
    if (!this.currentUser || this.walletUnsubscribe) return;
    
    const userRef = doc(db, 'users', this.currentUser.uid);
    
    this.walletUnsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        this.updateWalletDisplay(data.walletBalance || 0);
      }
    }, (error) => {
      console.error('Wallet listener error:', error);
    });
  }

  async refreshWalletBalance() {
    const btn = this.els.btnRefreshBalance;
    if (!btn || btn.disabled) return;
    
    // Check if user has wallet
    if (!this.userData.titanAccountNumber) {
      alert('No wallet found. Please create wallet first.');
      return;
    }
    
    btn.disabled = true;
    btn.textContent = '...';

    try {
      const checkPaymentsFn = httpsCallable(functions, 'checkRecentPayments');
      
      const result = await checkPaymentsFn({
        accountNumber: this.userData.titanAccountNumber
      });

      const { foundPayments, amountAdded, newBalance } = result.data;

      if (foundPayments > 0 && amountAdded > 0) {
        alert(`✅ Found ₦${amountAdded}!\nNew balance: ₦${newBalance}`);
      } else if (foundPayments > 0) {
        alert('Payments found but already recorded. No change.');
      } else {
        alert('No new payments found. If you sent money recently, please wait 2-3 minutes and try again.');
      }

    } catch (error) {
      console.error('Refresh error:', error);
      alert('Error checking payments: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '↻';
    }
  }

	

updateRoleBasedVisibility() {
  const isTier1 = this.hasTier1Access();
  const isTier2 = this.hasTier2Access(); // Uses new helper
  const show = isTier1 || isTier2;
  
  if (!show) {
    this.els.overflowBtn.style.display = 'none';
    return;
  }
  
  this.els.overflowBtn.style.display = 'block';
  
  const liAddKennel = document.getElementById('liAddKennel');
  const liNewKennelReq = document.getElementById('liNewKennelReq');
  const liUsersList = document.getElementById('liUsersList');
  const liPayList = document.getElementById('liPayList');
  const liViewRequests = document.getElementById('liViewRequests');
  const liKennelAdmin = document.getElementById('liKennelAdmin');
  const liPayReq = document.getElementById('liPayReq');
  
  if (liAddKennel) liAddKennel.style.display = isTier1 ? 'block' : 'none';
  if (liNewKennelReq) liNewKennelReq.style.display = isTier1 ? 'block' : 'none';
  if (liUsersList) liUsersList.style.display = isTier1 ? 'block' : 'none';
  if (liPayList) liPayList.style.display = show ? 'block' : 'none';
  
  if (liViewRequests) liViewRequests.style.display = 'block';
  if (liKennelAdmin) liKennelAdmin.style.display = 'block';
  if (liPayReq) liPayReq.style.display = 'block';
  
  // Button visibility
  this.els.btnAddKennel.style.display = isTier1 ? 'block' : 'none';
  this.els.btnViewRequests.style.display = (isTier1 || isTier2) ? 'block' : 'none';
  this.els.btnNewKennelRequests.style.display = isTier1 ? 'block' : 'none';
  
  // Layout: Tier 1 gets 2-column grid, others vertical
  if (isTier1 && this.els.actionGrid) {
    this.els.actionGrid.classList.add('tier1-layout');
  } else if (this.els.actionGrid) {
    this.els.actionGrid.classList.remove('tier1-layout');
  }
  
  this.updateKennelWalletVisibility();
}
  
    

  startUnreadListeners() {
    if (!this.currentUser) return;
    
    // Clean up existing listeners first
    this.cleanupListeners();
    
    // Get all kennels to listen to
    const kennelsToListen = this.getAdminKennels();
    
    // If no admin kennels (shouldn't happen for Tier 1/2), listen to default only
    if (kennelsToListen.length === 0 && this.userRole !== 'No Tier') {
      kennelsToListen.push({
        kennelPath: `locations/${this.userCountry}/states/${this.userState}/kennels/${this.userKennel}`,
        kennelName: this.userKennel,
        country: this.userCountry,
        state: this.userState,
        isDefault: true
      });
    }
    
    // Track badge counts per kennel
    this.kennelBadgeCounts = new Map();
    
    // Set up listeners for each kennel
    kennelsToListen.forEach(kennel => {
      this.setupKennelListeners(kennel);
    });
    
    // Payment requests listener (kennel-agnostic, uses user's kennel field)
    // For Tier 2, we need to check if ANY of their kennels have pending payments
   if (this.hasTier1Access() || this.hasTier2Access()) {
      const payReqQuery = query(
        collection(db, 'paymentRequests'),
        where('type', '==', 'event-payment'),
        where('status', '==', 'pending'),
        where('kennel', '==', this.userKennel)
      );
      
      const unsubscribePayment = onSnapshot(payReqQuery, (snap) => {
        this.unreadMap.payment = snap.size;
        this.recalcTotal();
      }, (error) => {
        console.error('Payment requests listener error:', error);
      });
      
      this.unsubscribers.push(unsubscribePayment);
    }
    
    // New kennel requests (Tier 1 only)
    if (this.userRole === 'Tier 1') {
      const newKennelQuery = query(
        collection(db, 'kennelRequests'),
        where('status', '==', 'pending')
      );
      
      const unsubscribeNewKennel = onSnapshot(newKennelQuery, (snap) => {
        this.unreadMap.new_kennel_requests = snap.size;
        this.recalcTotal();
        this.updateNewKennelRequestsButton(snap.size);
		        // Play sound for new kennel requests
        this.playRequestSound('new_kennel_requests', snap.size);
      }, (error) => {
        console.error('New kennel requests listener error:', error);
      });
      
      this.unsubscribers.push(unsubscribeNewKennel);
    }
  }

  setupKennelListeners(kennel) {
    const { country, state, kennelName, kennelPath, isDefault } = kennel;
    
    // Initialize badge count for this kennel
    const kennelKey = kennelPath;
    this.kennelBadgeCounts.set(kennelKey, 0);
    
    // Listen to join requests for this specific kennel
    const joinReqQuery = query(
      collection(db, 'locations', country, 'states', state, 'kennels', kennelName, 'ChatGroups', 'main', 'joinRequests'),
      where('status', '==', 'pending')
    );
    
    const unsubscribeViewRequests = onSnapshot(joinReqQuery, (snap) => {
      // Store count for this kennel
      this.kennelBadgeCounts.set(kennelKey, snap.size);
      
      // Calculate total across all kennels
      let totalViewRequests = 0;
      this.kennelBadgeCounts.forEach(count => {
        totalViewRequests += count;
      });
      
      this.unreadMap.view_requests = totalViewRequests;
      this.recalcTotal();
      this.updateViewRequestsButton(totalViewRequests);
	        // Play sound for new join requests
      this.playRequestSound('view_requests', totalViewRequests);
    }, (error) => {
      console.error(`Join requests listener error for ${kennelName}:`, error);
    });
    
    this.unsubscribers.push(unsubscribeViewRequests);
  }

  cleanupListeners() {
    // Unsubscribe all stored listeners
    this.unsubscribers.forEach(unsub => {
      if (typeof unsub === 'function') {
        unsub();
      }
    });
    this.unsubscribers = [];
    
    // Also clean up legacy unsubscribe if exists
    if (this.unsubscribeViewRequests) {
      this.unsubscribeViewRequests();
      this.unsubscribeViewRequests = null;
    }
  }

  updateViewRequestsButton(count) {
    const btn = this.els.btnViewRequests;
    if (!btn) return;
    
    // Remove existing badge if any
    const existingBadge = btn.querySelector('.request-badge');
    if (existingBadge) existingBadge.remove();
    
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'request-badge';
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.cssText = `
        position: absolute;
        top: -8px;
        right: -8px;
        background: #FF6D00;
        color: white;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;
      btn.style.position = 'relative';
      btn.appendChild(badge);
    }
  }

updateNewKennelRequestsButton(count) {
  const btn = this.els.btnNewKennelRequests;
  if (!btn) return;
  
  // Remove existing badge if any
  const existingBadge = btn.querySelector('.request-badge');
  if (existingBadge) existingBadge.remove();
  
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'request-badge';
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.cssText = `
      position: absolute;
      top: -8px;
      right: -8px;
      background: #FF6D00;
      color: white;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;
    btn.style.position = 'relative';
    btn.appendChild(badge);
  }
}
  recalcTotal() {
    const total = Object.values(this.unreadMap).reduce((a, b) => a + b, 0);
    this.updateBadge(total);
    
    const viewReqCnt = this.unreadMap.view_requests;
    const newKennelReqCnt = this.unreadMap.new_kennel_requests;
    const payCnt = this.unreadMap.payment;
    
    const menuViewRequests = document.getElementById('menuViewRequests');
    const menuNewKennelRequests = document.getElementById('menuNewKennelRequests');
    const menuPaymentRequests = document.getElementById('menuPaymentRequests');
    
    if (menuViewRequests) {
      menuViewRequests.textContent = viewReqCnt > 0 ? `View Requests (${viewReqCnt})` : 'View Requests';
    }
    if (menuNewKennelRequests) {
      menuNewKennelRequests.textContent = newKennelReqCnt > 0 ? `New Kennel Requests (${newKennelReqCnt})` : 'New Kennel Requests';
    }
    if (menuPaymentRequests) {
      menuPaymentRequests.textContent = payCnt > 0 ? `Payment Requests (${payCnt})` : 'Payment Requests';
    }
  }

  updateBadge(count) {
    this.els.badge.textContent = count > 99 ? '99+' : count;
    if (count > 0) {
      this.els.badge.classList.remove('hidden');
    } else {
      this.els.badge.classList.add('hidden');
    }
  }

  showMoreOptions() {
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
        this.handleMoreOption(index);
      };
    });
    
    dialog.querySelector('.more-cancel').onclick = () => dialog.remove();
    dialog.onclick = (e) => {
      if (e.target === dialog) dialog.remove();
    };
  }

  handleMoreOption(index) {
    switch(index) {
      case 0:
        this.logout();
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
        this.toggleDayNight();
        break;
      case 6:
        this.showAboutHashDialog();
        break;
    }
  }

  async showAddKennelDialog() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog" style="max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2>Add Kennel</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        
        <!-- Tabs -->
        <div class="dialog-tabs" style="display: flex; border-bottom: 1px solid #e0e0e0;">
          <button class="tab-btn active" data-tab="new" style="flex: 1; padding: 12px; border: none; background: #f5f5f5; cursor: pointer; font-weight: 500;">New Kennel</button>
          <button class="tab-btn" data-tab="existing" style="flex: 1; padding: 12px; border: none; background: white; cursor: pointer;">Existing Kennel</button>
        </div>
        
        <div class="modal-body" style="padding: 20px;">
          <!-- Logo Upload Section (shared) -->
          <div class="logo-upload-section" style="text-align: center; margin-bottom: 20px;">
            <div class="logo-preview" id="kennelLogoPreview" style="
              width: 120px;
              height: 120px;
              border-radius: 50%;
              background: #f5f5f5;
              margin: 0 auto 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              border: 2px dashed #ccc;
              overflow: hidden;
              position: relative;
            ">
              <span id="logoPlaceholder" style="font-size: 48px; color: #999;">🏠</span>
              <img id="logoPreviewImg" style="width: 100%; height: 100%; object-fit: cover; display: none;">
              <div class="logo-overlay" style="
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(0,0,0,0.6);
                color: white;
                padding: 4px;
                font-size: 12px;
                display: none;
              ">Change</div>
            </div>
            <input type="file" id="kennelLogoInput" accept="image/*" style="display: none;">
            <p style="font-size: 12px; color: #666; margin: 0;">Tap to add kennel logo</p>
          </div>

          <!-- NEW KENNEL TAB -->
          <div id="tab-new" class="tab-content active">
            <!-- Country -->
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #333;">Country</label>
              <select id="selCountryNew" style="
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 16px;
                box-sizing: border-box;
                background: white;
              ">
                <option value="" disabled selected>Select Country</option>
              </select>
            </div>

            <!-- State -->
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #333;">State</label>
              <select id="selStateNew" disabled style="
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 16px;
                box-sizing: border-box;
                background: white;
              ">
                <option value="" disabled selected>Select State</option>
              </select>
            </div>

            <!-- Kennel Name -->
            <div class="form-group" style="margin-bottom: 20px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #333;">Kennel Name</label>
              <input type="text" id="etKennelNameNew" placeholder="Enter new kennel name" style="
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 16px;
                box-sizing: border-box;
              " disabled>
            </div>
          </div>

          <!-- EXISTING KENNEL TAB -->
          <div id="tab-existing" class="tab-content" style="display: none;">
            <!-- Country -->
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #333;">Country</label>
              <select id="selCountryExisting" style="
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 16px;
                box-sizing: border-box;
                background: white;
              ">
                <option value="" disabled selected>Select Country</option>
              </select>
            </div>

            <!-- State -->
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #333;">State</label>
              <select id="selStateExisting" disabled style="
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 16px;
                box-sizing: border-box;
                background: white;
              ">
                <option value="" disabled selected>Select State</option>
              </select>
            </div>

            <!-- Existing Kennel Dropdown -->
            <div class="form-group" style="margin-bottom: 20px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: #333;">Select Kennel</label>
              <select id="selKennelExisting" disabled style="
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 16px;
                box-sizing: border-box;
                background: white;
              ">
                <option value="" disabled selected>Select Kennel</option>
              </select>
            </div>
          </div>

          <!-- Error message -->
          <div id="kennelError" style="color: #d32f2f; font-size: 14px; margin-bottom: 12px; display: none;"></div>
        </div>

        <div class="modal-footer" style="padding: 16px 20px; border-top: 1px solid #e0e0e0; display: flex; justify-content: flex-end; gap: 12px;">
          <button id="btnCancelKennel" class="btn-secondary" style="
            padding: 10px 20px;
            border: none;
            background: transparent;
            color: #666;
            font-size: 14px;
            cursor: pointer;
            border-radius: 4px;
          ">Cancel</button>
          <button id="btnSaveKennel" class="btn-primary" style="
            padding: 10px 24px;
            border: none;
            background: var(--clr-primary, #FF6D00);
            color: white;
            font-size: 14px;
            cursor: pointer;
            border-radius: 4px;
            font-weight: 500;
          " disabled>Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Get elements
    const logoPreview = overlay.querySelector('#kennelLogoPreview');
    const logoInput = overlay.querySelector('#kennelLogoInput');
    const logoPreviewImg = overlay.querySelector('#logoPreviewImg');
    const logoPlaceholder = overlay.querySelector('#logoPlaceholder');
    const logoOverlay = overlay.querySelector('.logo-overlay');
    
    // Tab buttons
    const tabBtns = overlay.querySelectorAll('.tab-btn');
    const tabContents = overlay.querySelectorAll('.tab-content');
    
    // New tab elements
    const countrySelectNew = overlay.querySelector('#selCountryNew');
    const stateSelectNew = overlay.querySelector('#selStateNew');
    const kennelNameInputNew = overlay.querySelector('#etKennelNameNew');
    
    // Existing tab elements
    const countrySelectExisting = overlay.querySelector('#selCountryExisting');
    const stateSelectExisting = overlay.querySelector('#selStateExisting');
    const kennelSelectExisting = overlay.querySelector('#selKennelExisting');
    
    const btnCancel = overlay.querySelector('#btnCancelKennel');
    const btnSave = overlay.querySelector('#btnSaveKennel');
    const errorDiv = overlay.querySelector('#kennelError');

    let selectedLogoFile = null;
    let activeTab = 'new';

    // Helper functions for error display
    const showError = (msg) => {
      errorDiv.textContent = msg;
      errorDiv.style.display = 'block';
    };

    const hideError = () => {
      errorDiv.style.display = 'none';
    };

    // Tab switching
    tabBtns.forEach(btn => {
      btn.onclick = () => {
        tabBtns.forEach(b => {
          b.classList.remove('active');
          b.style.background = 'white';
          b.style.fontWeight = 'normal';
        });
        btn.classList.add('active');
        btn.style.background = '#f5f5f5';
        btn.style.fontWeight = '500';
        
        activeTab = btn.dataset.tab;
        tabContents.forEach(content => {
          content.style.display = content.id === `tab-${activeTab}` ? 'block' : 'none';
        });
        
        updateSaveButton();
      };
    });

    // Logo upload handling
    logoPreview.onclick = () => logoInput.click();
    
    logoPreview.onmouseenter = () => {
      if (selectedLogoFile) logoOverlay.style.display = 'block';
    };
    logoPreview.onmouseleave = () => {
      logoOverlay.style.display = 'none';
    };

    logoInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showError('Please select an image file');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        showError('Image must be less than 5MB');
        return;
      }

      selectedLogoFile = file;

      const reader = new FileReader();
      reader.onload = (event) => {
        logoPreviewImg.src = event.target.result;
        logoPreviewImg.style.display = 'block';
        logoPlaceholder.style.display = 'none';
        logoOverlay.style.display = 'block';
        logoOverlay.textContent = 'Change';
        updateSaveButton();
      };
      reader.readAsDataURL(file);
    };

    // Load countries for both tabs - USE CACHE
    async function loadCountries() {
      try {
        let countries;
        
        // ADD THIS: Check cache first
        if (this.cache.countries) {
          countries = this.cache.countries;
        } else {
          console.log('Loading countries...');
          const snap = await getDocs(collection(db, 'locations'));
          countries = snap.docs.map(d => d.id).sort();
          this.cache.countries = countries; // Cache it
          console.log('Countries loaded:', countries);
        }
        
        // Populate both country dropdowns
        countries.forEach(c => {
          const optNew = document.createElement('option');
          optNew.value = c;
          optNew.textContent = c;
          countrySelectNew.appendChild(optNew);
          
          const optExisting = document.createElement('option');
          optExisting.value = c;
          optExisting.textContent = c;
          countrySelectExisting.appendChild(optExisting);
        });
      } catch (err) {
        console.error('Error loading countries:', err);
        showError('Failed to load countries. Check console.');
      }
    }

    // NEW TAB handlers
    countrySelectNew.addEventListener('change', async () => {
      // Reset downstream
      stateSelectNew.innerHTML = '<option value="" disabled selected>Select State</option>';
      stateSelectNew.disabled = false;
      kennelNameInputNew.value = '';
      kennelNameInputNew.disabled = true;
      hideError();
      
      try {
        const country = countrySelectNew.value;
        const cacheKey = country;
        
        // ADD THIS: Check cache
        let states;
        if (this.cache.states[cacheKey]) {
          states = this.cache.states[cacheKey];
        } else {
          console.log('Loading states for:', country);
          const snap = await getDocs(collection(db, 'locations', country, 'states'));
          states = snap.docs.map(d => d.id).sort();
          this.cache.states[cacheKey] = states; // Cache it
          console.log('States loaded:', states);
        }
        
        states.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          stateSelectNew.appendChild(opt);
        });
      } catch (err) {
        console.error('Error loading states:', err);
        showError('Failed to load states');
      }
    });

    stateSelectNew.addEventListener('change', () => {
      kennelNameInputNew.value = '';
      kennelNameInputNew.disabled = false;
      hideError();
    });

    kennelNameInputNew.addEventListener('input', () => {
      updateSaveButton();
    });

    // EXISTING TAB handlers
    countrySelectExisting.addEventListener('change', async () => {
      // Reset downstream
      stateSelectExisting.innerHTML = '<option value="" disabled selected>Select State</option>';
      stateSelectExisting.disabled = false;
      kennelSelectExisting.innerHTML = '<option value="" disabled selected>Select Kennel</option>';
      kennelSelectExisting.disabled = true;
      hideError();
      
      try {
        const country = countrySelectExisting.value;
        
        // ADD THIS: Check cache
        let states;
        if (this.cache.states[country]) {
          states = this.cache.states[country];
        } else {
          console.log('Loading states for:', country);
          const snap = await getDocs(collection(db, 'locations', country, 'states'));
          states = snap.docs.map(d => d.id).sort();
          this.cache.states[country] = states; // Cache it
          console.log('States loaded:', states);
        }
        
        states.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          stateSelectExisting.appendChild(opt);
        });
      } catch (err) {
        console.error('Error loading states:', err);
        showError('Failed to load states');
      }
    });

    stateSelectExisting.addEventListener('change', async () => {
      // Reset downstream
      kennelSelectExisting.innerHTML = '<option value="" disabled selected>Select Kennel</option>';
      kennelSelectExisting.disabled = false;
      hideError();
      
      try {
        const country = countrySelectExisting.value;
        const state = stateSelectExisting.value;
        const cacheKey = `${country}_${state}`;
        
        // ADD THIS: Check cache
        let kennels;
        if (this.cache.kennels[cacheKey]) {
          kennels = this.cache.kennels[cacheKey];
        } else {
          console.log('Loading kennels for:', country, state);
          const snap = await getDocs(collection(db, 'locations', country, 'states', state, 'kennels'));
          kennels = snap.docs.map(d => d.id).sort();
          this.cache.kennels[cacheKey] = kennels; // Cache it
          console.log('Kennels loaded:', kennels);
        }
        
        kennels.forEach(k => {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = k;
          kennelSelectExisting.appendChild(opt);
        });
      } catch (err) {
        console.error('Error loading kennels:', err);
        showError('Failed to load kennels');
      }
    });

    kennelSelectExisting.addEventListener('change', () => {
      updateSaveButton();
    });

    // Update save button state
    function updateSaveButton() {
      let canSave = false;
      
      if (activeTab === 'new') {
        const country = countrySelectNew.value;
        const state = stateSelectNew.value;
        const kennelName = kennelNameInputNew.value.trim();
        canSave = country && state && kennelName && selectedLogoFile;
      } else {
        const country = countrySelectExisting.value;
        const state = stateSelectExisting.value;
        const kennel = kennelSelectExisting.value;
        canSave = country && state && kennel && selectedLogoFile;
      }
      
      btnSave.disabled = !canSave;
    }

    // Cancel button
    btnCancel.onclick = () => overlay.remove();

    // Save button
    btnSave.onclick = async () => {
      let country, state, kennelName, isNew;

      if (activeTab === 'new') {
        country = countrySelectNew.value;
        state = stateSelectNew.value;
        kennelName = kennelNameInputNew.value.trim();
        isNew = true;
      } else {
        country = countrySelectExisting.value;
        state = stateSelectExisting.value;
        kennelName = kennelSelectExisting.value;
        isNew = false;
      }

      // Validation
      if (!country) {
        showError('Please select a country');
        return;
      }
      if (!state) {
        showError('Please select a state');
        return;
      }
      if (!kennelName) {
        showError('Please enter or select a kennel name');
        return;
      }
      if (!selectedLogoFile) {
        showError('Please upload a kennel logo');
        return;
      }

      // Disable buttons during save
      btnSave.disabled = true;
      btnCancel.disabled = true;
      btnSave.textContent = 'Saving...';

      try {
        const kennelRef = doc(db, 'locations', country, 'states', state, 'kennels', kennelName);
        
        if (isNew) {
          // Check if kennel already exists
          const kennelSnap = await getDoc(kennelRef);
          if (kennelSnap.exists()) {
            throw new Error('A kennel with this name already exists in this state');
          }
        }

        // Upload logo to Firebase Storage
        const logoPath = `kennelLogos/${country}_${state}_${kennelName}_${Date.now()}.jpg`;
        const logoRef = ref(storage, logoPath);
        
        // Process image (resize and compress)
        const processedBlob = await this.processKennelLogo(selectedLogoFile);
        await uploadBytes(logoRef, processedBlob);
        const logoUrl = await getDownloadURL(logoRef);

        if (isNew) {
          // Create new kennel document
          await setDoc(kennelRef, {
            name: kennelName,
            country: country,
            state: state,
            logoUrl: logoUrl,
            createdAt: Timestamp.now(),
            createdBy: this.currentUser.uid,
            createdByHandle: this.userData?.hashHandle || 'Unknown',
            status: 'active'
          });

          // Also add to kennelRequests for admin approval (optional)
          await setDoc(doc(db, 'kennelRequests', `${country}_${state}_${kennelName}`), {
            kennelName: kennelName,
            country: country,
            state: state,
            logoUrl: logoUrl,
            requestedBy: this.currentUser.uid,
            requestedByHandle: this.userData?.hashHandle || 'Unknown',
            status: 'approved',
            createdAt: Timestamp.now(),
            approvedAt: Timestamp.now(),
            approvedBy: this.currentUser.uid
          });

          overlay.remove();
          alert(`Kennel "${kennelName}" created successfully!`);
        } else {
          // Update existing kennel with new logo
          await updateDoc(kennelRef, {
            logoUrl: logoUrl,
            updatedAt: Timestamp.now(),
            updatedBy: this.currentUser.uid
          });

          overlay.remove();
          alert(`Logo updated for "${kennelName}" successfully!`);
        }
        
        // Refresh home data if needed
        this.loadUserData(this.currentUser.uid);

      } catch (error) {
        console.error('Error saving kennel:', error);
        showError(error.message || 'Failed to save kennel');
        btnSave.disabled = false;
        btnCancel.disabled = false;
        btnSave.textContent = 'Save';
      }
    };

    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    // Initialize - load countries
    await loadCountries();
  }
  
  // Helper method to process kennel logo (resize to 512x512, circular crop)
  processKennelLogo = async (file) => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 512;
      
      canvas.width = size;
      canvas.height = size;
      
      const img = new Image();
      img.onload = () => {
        // Calculate crop to center square
        let sx, sy, sWidth, sHeight;
        if (img.width > img.height) {
          sHeight = img.height;
          sWidth = img.height;
          sx = (img.width - img.height) / 2;
          sy = 0;
        } else {
          sWidth = img.width;
          sHeight = img.width;
          sx = 0;
          sy = (img.height - img.width) / 2;
        }
        
        // Clear and create circular clip
        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        
        // Draw image
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, size, size);
        
        // Convert to blob
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.9);
      };
      img.onerror = reject;
      
      const reader = new FileReader();
      reader.onload = (e) => img.src = e.target.result;
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  showRequestsDialog() {
    // Reset badge count
    this.unreadMap.view_requests = 0;
    this.recalcTotal();
    this.updateViewRequestsButton(0);
    
    // Create dialog overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
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
      font-family: sans-serif;
    `;
    
    overlay.innerHTML = `
      <div class="requests-dialog" style="
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
          <h2 style="margin: 0; font-size: 20px;">Join Requests</h2>
          <button id="close-requests" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
          ">×</button>
        </div>
        
        <div id="requests-list" style="
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        ">
          <div style="text-align: center; padding: 40px; color: #666;">
            Loading requests...
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Close button handler
    overlay.querySelector('#close-requests').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    
    // Load and listen to requests
    this.loadJoinRequests(overlay);
  }
  
  async handleViewRequestsClick() {
  const isTier1 = this.userRole === 'Tier 1';
  
  if (isTier1) {
    // Tier 1: Direct to default kennel requests
    this.showRequestsDialog();
  } else {
    // Tier 2: Show kennel selector dialog first
    await this.showKennelSelectorForRequests();
  }
}

async showKennelSelectorForRequests() {
  const adminKennels = this.getAdminKennels();
  
  if (adminKennels.length === 0) {
    alert('You are not an admin of any kennel');
    return;
  }
  
  if (adminKennels.length === 1) {
    // Only one kennel, go directly to it
    const kennel = adminKennels[0];
    this.showRequestsDialogForKennel(kennel);
    return;
  }
  
  // Multiple kennels - show selector
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
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
    font-family: sans-serif;
  `;
  
  // Find default kennel index
  const defaultKennelIndex = adminKennels.findIndex(k => 
    k.kennelName === this.userKennel && 
    k.country === this.userCountry && 
    k.state === this.userState
  );
  const preselectedIndex = defaultKennelIndex >= 0 ? defaultKennelIndex : 0;
  
  overlay.innerHTML = `
    <div style="
      background: white;
      width: 90%;
      max-width: 400px;
      border-radius: 16px;
      overflow: hidden;
    ">
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid #e0e0e0;
        background: #FF6D00;
      ">
        <h2 style="margin: 0; font-size: 18px; color: white;">Select Kennel</h2>
        <button id="close-kennel-select" style="
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: white;
        ">×</button>
      </div>
      
      <div style="padding: 20px;">
        <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">
          You are admin of ${adminKennels.length} kennels. Select which one to view requests for:
        </p>
        
        <select id="kennel-select-dropdown" style="
          width: 100%;
          padding: 12px;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 16px;
          margin-bottom: 20px;
        ">
          ${adminKennels.map((k, idx) => `
            <option value="${idx}" ${idx === preselectedIndex ? 'selected' : ''}>
              ${this.escapeHtml(k.kennelName)} (${this.escapeHtml(k.state)}, ${this.escapeHtml(k.country)})
            </option>
          `).join('')}
        </select>
        
        <button id="view-requests-for-kennel" style="
          width: 100%;
          padding: 14px;
          background: #FF6D00;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          font-weight: 500;
        ">View Requests</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Close handlers
  overlay.querySelector('#close-kennel-select').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  
  // View requests handler
  overlay.querySelector('#view-requests-for-kennel').onclick = () => {
    const select = overlay.querySelector('#kennel-select-dropdown');
    const selectedIndex = parseInt(select.value);
    const selectedKennel = adminKennels[selectedIndex];
    overlay.remove();
    this.showRequestsDialogForKennel(selectedKennel);
  };
}

showRequestsDialogForKennel(kennel) {
  // Temporarily override user context for this kennel
  const originalCountry = this.userCountry;
  const originalState = this.userState;
  const originalKennel = this.userKennel;
  
  this.userCountry = kennel.country;
  this.userState = kennel.state;
  this.userKennel = kennel.kennelName;
  
  // Show the dialog
  this.showRequestsDialog();
  
  // Restore original context after dialog opens
  // Note: The dialog uses these values at open time, so they're captured
  // We restore immediately since showRequestsDialog is synchronous setup
  this.userCountry = originalCountry;
  this.userState = originalState;
  this.userKennel = originalKennel;
}

  loadJoinRequests(overlay) {
    const listContainer = overlay.querySelector('#requests-list');
    
    const joinReqQuery = query(
      collection(db, 'locations', this.userCountry, 'states', this.userState, 'kennels', this.userKennel, 'ChatGroups', 'main', 'joinRequests'),
      where('status', '==', 'pending')
    );
    
    // Real-time listener
    const unsubscribe = onSnapshot(joinReqQuery, (snapshot) => {
      if (snapshot.empty) {
        listContainer.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #666;">
            <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
            <p>No pending join requests</p>
          </div>
        `;
        return;
      }
      
      listContainer.innerHTML = snapshot.docs.map(doc => {
        const data = doc.data();
        const requestId = doc.id;
        const userPic = data.userPic || '';
        const userName = data.userName || 'Unknown';
        const timestamp = data.timestamp?.toDate?.() || new Date();
        const timeAgo = this.formatTimeAgo(timestamp);
        
        return `
          <div class="request-item" data-request-id="${requestId}" data-uid="${data.uid}" style="
            display: flex;
            align-items: center;
            padding: 16px;
            border-bottom: 1px solid #eee;
            gap: 12px;
          ">
            <img src="${userPic}" 
                 alt="${userName}" 
                 style="
                   width: 56px;
                   height: 56px;
                   border-radius: 50%;
                   object-fit: cover;
                   border: 2px solid #e0e0e0;
                 "
                 onerror="this.src='${this.createPlaceholder(userName)}'">
            
            <div style="flex: 1;">
              <div style="font-weight: 600; font-size: 16px; color: #333;">
                ${this.escapeHtml(userName)}
              </div>
              <div style="font-size: 12px; color: #999; margin-top: 4px;">
                ${timeAgo}
              </div>
            </div>
            
            <div style="display: flex; gap: 8px;">
              <button class="approve-btn" data-request-id="${requestId}" data-uid="${data.uid}" style="
                padding: 8px 16px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 20px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
              ">Approve</button>
              
              <button class="decline-btn" data-request-id="${requestId}" style="
                padding: 8px 16px;
                background: #f5f5f5;
                color: #666;
                border: none;
                border-radius: 20px;
                cursor: pointer;
                font-size: 14px;
              ">Decline</button>
            </div>
          </div>
        `;
      }).join('');
      
      // Attach button handlers
      listContainer.querySelectorAll('.approve-btn').forEach(btn => {
        btn.onclick = () => this.handleJoinRequest(btn.dataset.requestId, btn.dataset.uid, 'approved', overlay);
      });
      
      listContainer.querySelectorAll('.decline-btn').forEach(btn => {
        btn.onclick = () => this.handleJoinRequest(btn.dataset.requestId, null, 'declined', overlay);
      });
    }, (error) => {
      console.error('Join requests listener error:', error);
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #d32f2f;">
          <p>Error loading requests: ${error.message}</p>
        </div>
      `;
    });
    
    // Store unsubscribe for cleanup
    overlay._unsubscribe = unsubscribe;
    
    // Cleanup on close
    const originalRemove = overlay.remove.bind(overlay);
    overlay.remove = () => {
      if (overlay._unsubscribe) overlay._unsubscribe();
      originalRemove();
    };
  }

  async handleJoinRequest(requestId, userUid, status, overlay) {
    try {
      const requestRef = doc(db, 'locations', this.userCountry, 'states', this.userState, 'kennels', this.userKennel, 'ChatGroups', 'main', 'joinRequests', requestId);
      
      if (status === 'approved') {
        // Add kennel to user's joinedKennels array
        const userRef = doc(db, 'users', userUid);
        const kennelPath = `locations/${this.userCountry}/states/${this.userState}/kennels/${this.userKennel}`;
        
        await updateDoc(userRef, {
          joinedKennels: arrayUnion(kennelPath)
        });
        
        // Update request status
        await updateDoc(requestRef, {
          status: 'approved',
          approvedAt: Timestamp.now(),
          approvedBy: this.currentUser.uid
        });
        
        // Send notification to user
        await this.sendApprovalNotification(userUid);
        
      } else {
        // Decline - just update status
        await updateDoc(requestRef, {
          status: 'declined',
          declinedAt: Timestamp.now(),
          declinedBy: this.currentUser.uid
        });
      }
	  
	      // Reset played count for this kennel so new requests trigger sound again
    const kennelKey = `locations/${this.userCountry}/states/${this.userState}/kennels/${this.userKennel}`;
    this.kennelBadgeCounts.set(kennelKey, 0);
    // Recalculate total
    let totalViewRequests = 0;
    this.kennelBadgeCounts.forEach(count => {
      totalViewRequests += count;
    });
    this.lastPlayedCounts.view_requests = totalViewRequests;
      
      // Show success toast
      this.showToast(status === 'approved' ? 'Request approved!' : 'Request declined');
      
    } catch (error) {
      console.error('Error handling request:', error);
      this.showToast('Error: ' + error.message, 'error');
    }
  }

  async sendApprovalNotification(userUid) {
    try {
      const notificationRef = doc(db, 'users', userUid, 'notifications', `approved_${this.userKennel}_${Date.now()}`);
      await setDoc(notificationRef, {
        type: 'join_approved',
        title: 'Join Request Approved',
        body: `You have been approved to join ${this.userKennel}`,
        kennelPath: `locations/${this.userCountry}/states/${this.userState}/kennels/${this.userKennel}`,
        kennelName: this.userKennel,
        timestamp: Timestamp.now(),
        read: false
      });
    } catch (e) {
      console.error('Notification error:', e);
    }
  }

  formatTimeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  createPlaceholder(text, color = '#FF6D00') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${color}"/><text x="50" y="65" text-anchor="middle" font-size="45" fill="white" font-family="Arial">${text.charAt(0).toUpperCase()}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
  

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

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
  }

  async showKennelAdminDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
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
      font-family: sans-serif;
    `;
    
    const isTier1 = this.userRole === 'Tier 1';
    
    // For Tier 2, get all kennels where they are admin
    const adminKennels = isTier1 ? [] : this.getAdminKennels();
    const hasMultipleKennels = adminKennels.length > 1;
    
    overlay.innerHTML = `
      <div style="
        background: white;
        width: 90%;
        max-width: 600px;
        max-height: 90vh;
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
          <h2 style="margin: 0; font-size: 20px;">Kennel Admin</h2>
          <button id="close-admin" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
          ">×</button>
        </div>
        
        <div style="
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        ">
          ${!isTier1 ? `
            <div style="
              background: #FFF3E0;
              padding: 12px;
              border-radius: 8px;
              margin-bottom: 16px;
              font-size: 14px;
              color: #E65100;
            ">
              <strong>Tier 2 Mode:</strong> You can manage kennels where you are an admin
            </div>
          ` : ''}
          
                  <!-- Kennel Selector (Tier 2 only) -->
          <div style="margin-bottom: 20px;">
            ${isTier1 ? `
              <!-- Tier 1: No kennel selector, uses Location Pickers below -->
              <input type="hidden" id="admin-kennel-select" value="custom">
            ` : !hasMultipleKennels ? `
              <!-- Single kennel - show as read-only -->
              <div style="
                padding: 12px;
                background: #f5f5f5;
                border-radius: 8px;
                font-weight: 500;
              ">
                Managing: ${adminKennels[0]?.kennelName || this.userKennel}
              </div>
              <input type="hidden" id="admin-kennel-path" value="${adminKennels[0]?.kennelPath || `locations/${this.userCountry}/states/${this.userState}/kennels/${this.userKennel}`}">
            ` : `
              <!-- Multiple kennels dropdown for Tier 2 -->
              <div style="margin-bottom: 12px;">
                <label style="display: block; margin-bottom: 6px; font-weight: 500;">Select Kennel to Manage</label>
                <select id="admin-kennel-select" style="
                  width: 100%;
                  padding: 12px;
                  border: 1px solid #ddd;
                  border-radius: 8px;
                  font-size: 16px;
                ">
                  ${adminKennels.map(k => `
                    <option value="${k.kennelPath}">${k.kennelName} (${k.designation})</option>
                  `).join('')}
                </select>
              </div>
            `}
            
            <!-- Tier 1 location selectors (only for Tier 1) -->
            ${isTier1 ? `
              <div id="tier1-selectors" style="display: none;">
                <div style="margin-bottom: 12px;">
                  <label style="display: block; margin-bottom: 6px; font-weight: 500;">Country</label>
                  <select id="admin-country" style="
                    width: 100%;
                    padding: 12px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    font-size: 16px;
                  ">
                    <option value="">Select Country</option>
                  </select>
                </div>
                
                <div style="margin-bottom: 12px;">
                  <label style="display: block; margin-bottom: 6px; font-weight: 500;">State</label>
                  <select id="admin-state" disabled style="
                    width: 100%;
                    padding: 12px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    font-size: 16px;
                  ">
                    <option value="">Select State</option>
                  </select>
                </div>
                
                <div style="margin-bottom: 12px;">
                  <label style="display: block; margin-bottom: 6px; font-weight: 500;">Kennel</label>
                  <select id="admin-kennel" disabled style="
                    width: 100%;
                    padding: 12px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    font-size: 16px;
                  ">
                    <option value="">Select Kennel</option>
                  </select>
                </div>
              </div>
            ` : ''}
          </div>
          
          <!-- Select All -->
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            padding: 12px;
            background: #f5f5f5;
            border-radius: 8px;
          ">
            <input type="checkbox" id="select-all" style="width: 20px; height: 20px;">
            <label for="select-all" style="font-weight: 500; cursor: pointer;">Select All</label>
          </div>
          
          <!-- Previous Admins Section -->
          <div style="margin-bottom: 24px;">
            <h3 style="font-size: 16px; margin-bottom: 12px; color: #666;">Current Admins</h3>
            
            <div id="prev-admins-list" style="display: flex; flex-direction: column; gap: 12px;">
              <div style="color: #999; padding: 20px; text-align: center;">
                ${isTier1 ? 'Select a kennel to load current admins' : 'Select a kennel above'}
              </div>
            </div>
          </div>
          
                 <!-- New Admins Section -->
          <div style="margin-bottom: 20px;">
            <h3 style="font-size: 16px; margin-bottom: 12px; color: #666;">New Admins</h3>
            
            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${['Grand Master', 'Hash Master', 'Religious Adviser', 'On Sec'].map(role => `
                <div style="
                  display: flex;
                  align-items: center;
                  gap: 12px;
                  padding: 12px;
                  border: 1px solid #e0e0e0;
                  border-radius: 8px;
                ">
                  <input type="checkbox" id="new-${role.replace(/\s+/g, '')}" style="width: 20px; height: 20px;">
                  <div style="flex: 1;">
                    <div style="font-weight: 500; margin-bottom: 4px;">${role}</div>
                  </div>
                  <select id="handle-${role.replace(/\s+/g, '')}" 
                         disabled
                         style="
                    padding: 8px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    font-size: 14px;
                    min-width: 150px;
                  ">
                    <option value="">Select Hash Handle</option>
                  </select>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div style="
          padding: 16px 20px;
          border-top: 1px solid #e0e0e0;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        ">
          <button id="cancel-admin" style="
            padding: 10px 20px;
            border: none;
            background: #f5f5f5;
            color: #666;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
          ">Cancel</button>
          <button id="save-admin" style="
            padding: 10px 20px;
            border: none;
            background: #FF6D00;
            color: white;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
          ">Save Changes</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Event handlers
    overlay.querySelector('#close-admin').onclick = () => overlay.remove();
    overlay.querySelector('#cancel-admin').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    
    // Initialize the dialog
    await this.initKennelAdminDialog(overlay, isTier1, adminKennels, hasMultipleKennels);
  }

  async saveKennelAdminChanges(overlay, isTier1, adminKennels) {
    try {
      let country, state, kennel, kennelPath;
      
      if (isTier1) {
        // Tier 1 uses location pickers directly
        country = overlay.querySelector('#admin-country').value;
        state = overlay.querySelector('#admin-state').value;
        kennel = overlay.querySelector('#admin-kennel').value;
        
        // Validate ALL fields
        if (!country || !state || !kennel) {
          alert('Please select country, state, and kennel');
          return;
        }
      } else {
        // Tier 2 - get from selected kennel or hidden field
        const kennelSelect = overlay.querySelector('#admin-kennel-select');
        const hiddenPath = overlay.querySelector('#admin-kennel-path');
        
        // Check for dropdown first (multiple kennels case)
        if (kennelSelect && kennelSelect.value && kennelSelect.value !== '') {
          const selected = adminKennels.find(k => k.kennelPath === kennelSelect.value);
          if (selected) {
            country = selected.country;
            state = selected.state;
            kennel = selected.kennelName;
          }
        } 
        // Check for hidden path (single kennel case)
        else if (hiddenPath && hiddenPath.value) {
          const parts = hiddenPath.value.split('/');
          if (parts.length >= 6) {
            country = parts[1];
            state = parts[3];
            kennel = parts[5];
          }
        }
        // Fallback: use first adminKennel if available
        else if (adminKennels && adminKennels.length > 0) {
          const firstKennel = adminKennels[0];
          country = firstKennel.country;
          state = firstKennel.state;
          kennel = firstKennel.kennelName;
        }
        
        // Validate ALL fields for Tier 2
        if (!country || !state || !kennel) {
          alert('Please select a kennel');
          return;
        }
      }
      
      kennelPath = `locations/${country}/states/${state}/kennels/${kennel}`;
      
      // Rest of save logic
      const currentAdmins = JSON.parse(overlay.dataset.currentAdmins || '{}');
      
      // Build updates
      const designationUpdates = {};
      const userUpdates = [];
      
      // Process previous admins (removals)
      const prevRoles = ['Grand Master', 'Hash Master', 'Religious Adviser', 'On Sec'];
      for (const role of prevRoles) {
        const checkbox = overlay.querySelector(`#prev-${role.replace(/\s+/g, '')}`);
        if (checkbox && checkbox.checked) {
          const adminPhone = currentAdmins[role];
          
          // FIX #1: Skip if role is unassigned (no phone number)
          if (!adminPhone) {
            console.log(`Skipping ${role} - no admin assigned`);
            continue;
          }
          
          const newRoleSelect = overlay.querySelector(`#prev-role-${role.replace(/\s+/g, '')}`);
          const newRole = newRoleSelect?.value || 'No Tier';
          
          designationUpdates[role] = deleteField();
          
          // FIX #2: Now safe to query because adminPhone is guaranteed to exist
          const userQuery = query(collection(db, 'users'), where('phone', '==', adminPhone));
          const userSnap = await getDocs(userQuery);
          const userDoc = userSnap.docs[0];
          
          if (userDoc) {
            const userData = userDoc.data();
            const isDefaultKennel = userData.kennel === kennel && 
                                   userData.country === country && 
                                   userData.state === state;
            
            if (isDefaultKennel) {
              userUpdates.push({
                ref: userDoc.ref,
                data: {
                  role: 'No Tier',
                  designation: newRole
                }
              });
            } else {
              const otherKennels = userData.otherKennels || [];
              const updatedOthers = otherKennels.filter(k => k.kennelPath !== kennelPath);
              userUpdates.push({
                ref: userDoc.ref,
                data: { otherKennels: updatedOthers }
              });
            }
          }
        }
      }
      
      // Process new admins (additions)
      const newRoles = [
        { id: 'GrandMaster', name: 'Grand Master' },
        { id: 'HashMaster', name: 'Hash Master' },
        { id: 'ReligiousAdviser', name: 'Religious Adviser' },
        { id: 'OnSec', name: 'On Sec' }
      ];
      
      for (const role of newRoles) {
        const checkbox = overlay.querySelector(`#new-${role.id}`);
        if (checkbox && checkbox.checked) {
          const handleInput = overlay.querySelector(`#handle-${role.id}`);
          const handle = handleInput.value.trim();
          
          if (!handle) {
            alert(`Please select a hash handle for ${role.name}`);
            return;
          }
          
          // Role is determined by the checkbox, not a dropdown
          const newRole = role.name;
          
          const userQuery = query(collection(db, 'users'), where('hashHandle', '==', handle));
          const userSnap = await getDocs(userQuery);
          const userDoc = userSnap.docs[0];
          
          if (!userDoc) {
            alert(`User not found: ${handle}`);
            return;
          }
          
          const userData = userDoc.data();
          const userPhone = userData.phone;
          
          designationUpdates[role.name] = userPhone;
          
          const isTheirDefault = userData.kennel === kennel && 
                                userData.country === country && 
                                userData.state === state;
          
          if (isTheirDefault) {
            userUpdates.push({
              ref: userDoc.ref,
              data: {
                role: 'Tier 2',
                designation: role.name
              }
            });
          } else {
            const otherKennels = userData.otherKennels || [];
            const existingIndex = otherKennels.findIndex(k => k.kennelPath === kennelPath);
            
            const newEntry = {
              kennelPath: kennelPath,
              kennelName: kennel,
              country: country,
              state: state,
              role: 'Tier 2',
              designation: role.name
            };
            
            if (existingIndex >= 0) {
              otherKennels[existingIndex] = newEntry;
            } else {
              otherKennels.push(newEntry);
            }
            
            userUpdates.push({
              ref: userDoc.ref,
              data: { otherKennels: otherKennels }
            });
          }
        }
      }
      
      // Execute batch
      const batch = writeBatch(db);
      
      if (Object.keys(designationUpdates).length > 0) {
        const designationsRef = doc(db, 'designations', kennel);
        batch.set(designationsRef, designationUpdates, { merge: true });
      }
      
      for (const update of userUpdates) {
        batch.update(update.ref, update.data);
      }
      
      await batch.commit();
      
      alert('Changes saved successfully!');
      overlay.remove();
      
    } catch (error) {
      console.error('Error saving changes:', error);
      alert('Error: ' + error.message);
    }
  }

  getAdminKennels() {
    const kennels = [];
    
    // Check if they are admin in their default kennel
    if (this.userRole === 'Tier 2') {
      kennels.push({
        kennelPath: `locations/${this.userCountry}/states/${this.userState}/kennels/${this.userKennel}`,
        kennelName: this.userKennel,
        country: this.userCountry,
        state: this.userState,
        designation: this.userData?.designation || 'Admin',
        isDefault: true
      });
    }
    
    // Check otherKennels array
    const others = this.userData?.otherKennels || [];
    others.forEach(k => {
      if (k.role === 'Tier 2') {
        kennels.push({
          ...k,
          isDefault: false
        });
      }
    });
    
    return kennels;
  }

  // NEW: Show New Kennel Requests Dialog (matches Android implementation)
  showNewKennelRequestsDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
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
      font-family: sans-serif;
    `;
    
    overlay.innerHTML = `
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
          <h2 style="margin: 0; font-size: 20px;">New Kennel Requests</h2>
          <button id="close-new-kennel" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
          ">×</button>
        </div>
        
        <div id="new-kennel-requests-list" style="
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        ">
          <div style="text-align: center; padding: 40px; color: #666;">
            Loading requests...
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Close button handler
    overlay.querySelector('#close-new-kennel').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    
    // Load and display requests
    this.loadNewKennelRequests(overlay);
  }

  async loadNewKennelRequests(overlay) {
    const listContainer = overlay.querySelector('#new-kennel-requests-list');
    
    try {
      // Query pending kennel requests
      const requestsQuery = query(
        collection(db, 'kennelRequests'),
        where('status', '==', 'pending')
      );
      
      const snapshot = await getDocs(requestsQuery);
      
      if (snapshot.empty) {
        listContainer.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #666;">
            <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
            <p>No pending kennel requests</p>
          </div>
        `;
        return;
      }
      
      // Pre-fetch all countries for location correction
      let allCountries = [];
      try {
        if (this.cache.countries) {
          allCountries = this.cache.countries;
        } else {
          const countriesSnap = await getDocs(collection(db, 'locations'));
          allCountries = countriesSnap.docs.map(d => d.id).sort();
          this.cache.countries = allCountries;
        }
      } catch (e) {
        console.error('Error loading countries:', e);
      }
      
      // Build country options HTML
      const countryOptions = allCountries.map(c => 
        `<option value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</option>`
      ).join('');
      
      // Render requests list
      listContainer.innerHTML = await Promise.all(snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        const requestId = docSnap.id;
        const rawName = data.requestedName || data.kennelName || 'Unknown';
        const canonicalName = data.canonicalName || rawName;
        const requesterCountry = data.country || '';
        const requesterState = data.state || '';
        const requesterUid = data.requesterUid || data.requestedBy || '';
        
        // Fetch requester details
        let requesterHandle = 'Unknown';
        let requesterPhone = '';
        if (requesterUid) {
          try {
            const userDoc = await getDoc(doc(db, 'users', requesterUid));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              requesterHandle = userData.hashHandle || 'Unknown';
              requesterPhone = userData.phone || '';
            }
          } catch (e) {
            console.error('Error fetching user:', e);
          }
        }
        
        // Pre-fetch states for the requester's country (if available)
        let statesForCountry = [];
        if (requesterCountry) {
          try {
            const cacheKey = requesterCountry;
            if (this.cache.states[cacheKey]) {
              statesForCountry = this.cache.states[cacheKey];
            } else {
              const statesSnap = await getDocs(collection(db, 'locations', requesterCountry, 'states'));
              statesForCountry = statesSnap.docs.map(d => d.id).sort();
              this.cache.states[cacheKey] = statesForCountry;
            }
          } catch (e) {
            console.error('Error loading states:', e);
          }
        }
        
        const stateOptions = statesForCountry.map(s => 
          `<option value="${this.escapeHtml(s)}" ${s === requesterState ? 'selected' : ''}>${this.escapeHtml(s)}</option>`
        ).join('');
        
        // Pre-fetch kennels for the current state
        let currentKennels = [];
        if (requesterCountry && requesterState) {
          try {
            const cacheKey = `${requesterCountry}_${requesterState}`;
            if (this.cache.kennels[cacheKey]) {
              currentKennels = this.cache.kennels[cacheKey];
            } else {
              const kennelsSnap = await getDocs(
                collection(db, 'locations', requesterCountry, 'states', requesterState, 'kennels')
              );
              currentKennels = kennelsSnap.docs.map(d => ({
                name: d.id,
                path: `locations/${requesterCountry}/states/${requesterState}/kennels/${d.id}`
              }));
              this.cache.kennels[cacheKey] = currentKennels;
            }
          } catch (e) {
            console.error('Error loading kennels:', e);
          }
        }
        
        // Check for potential duplicates (for warning)
        const potentialDuplicates = currentKennels.filter(k => {
          const kennelLower = k.name.toLowerCase();
          const requestLower = canonicalName.toLowerCase();
          const kennelWords = kennelLower.split(/\s+/);
          const requestWords = requestLower.split(/\s+/);
          const hasWordOverlap = kennelWords.some(w => requestWords.includes(w) && w.length > 3);
          const contains = kennelLower.includes(requestLower) || requestLower.includes(kennelLower);
          return hasWordOverlap || contains;
        });
        
        const kennelOptions = currentKennels.map(k => {
          const isDuplicate = potentialDuplicates.some(d => d.path === k.path);
          const warning = isDuplicate ? ' ⚠️' : '';
          return `<option value="${this.escapeHtml(k.path)}">${this.escapeHtml(k.name)}${warning}</option>`;
        }).join('');
        
        const hasDuplicates = potentialDuplicates.length > 0;
        
        return `
          <div class="new-kennel-request-item" data-request-id="${requestId}" style="
            display: flex;
            flex-direction: column;
            padding: 16px;
            border-bottom: 1px solid #eee;
            gap: 12px;
          ">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 16px; color: #333;">
                  ${this.escapeHtml(rawName)}
                </div>
                <div style="font-size: 14px; color: #666; margin-top: 4px;">
                  ${this.escapeHtml(canonicalName)}
                </div>
                
                ${requesterUid ? `
                  <div style="font-size: 12px; color: #333; margin-top: 8px; padding: 6px 10px; background: #FFF3E0; border-radius: 4px; display: inline-block; border-left: 3px solid #FF6D00;">
                    <strong>👤 Requester:</strong> ${this.escapeHtml(requesterHandle)}${requesterPhone ? `<br>📞 ${this.escapeHtml(requesterPhone)}` : ''}
                  </div>
                ` : `
                  <div style="font-size: 12px; color: #999; margin-top: 8px; padding: 6px 10px; background: #f5f5f5; border-radius: 4px; display: inline-block;">
                    <strong>👤 Requester:</strong> Anonymous (no UID stored)
                  </div>
                `}
              </div>
            </div>
            
                        <!-- LOCATION CORRECTION SECTION -->
            <div style="background: #E8F5E9; padding: 12px; border-radius: 8px; border: 1px solid #81C784;">
              <div style="font-weight: 600; font-size: 13px; color: #2E7D32; margin-bottom: 8px;">
                🌍 Location (Correct if wrong)
              </div>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px;">
                <select class="correct-country" style="
                  width: 100%;
                  padding: 10px 12px;
                  border: 1px solid #ddd;
                  border-radius: 6px;
                  font-size: 14px;
                  background: white;
                ">
                  <option value="">Select Country</option>
                  ${countryOptions}
                </select>
                <select class="correct-state" disabled style="
                  width: 100%;
                  padding: 10px 12px;
                  border: 1px solid #ddd;
                  border-radius: 6px;
                  font-size: 14px;
                  background: white;
                ">
                  <option value="">Select State</option>
                  ${stateOptions}
                </select>
              </div>
              <div style="font-size: 11px; color: #666;">
                Requester said: <strong>${this.escapeHtml(requesterCountry)} / ${this.escapeHtml(requesterState)}</strong>
              </div>
            </div>
            
            <!-- KENNEL SELECTION (Dynamic based on corrected location) -->
            <div style="background: #F5F5F5; padding: 12px; border-radius: 8px; border: 1px solid #E0E0E0;">
              <div style="font-weight: 600; font-size: 13px; color: #333; margin-bottom: 8px;">
                ${hasDuplicates ? '⚠️ Similar kennels found below' : '🔗 Link to Existing Kennel (Optional)'}
              </div>
              <select class="existing-kennel-select" style="
                width: 100%;
                padding: 10px 12px;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-size: 14px;
                background: white;
              ">
                <option value="" selected>-- Create NEW kennel (enter name below) --</option>
                <optgroup label="Existing Kennels in selected location">
                  ${kennelOptions || '<option value="" disabled>No kennels found in this location</option>'}
                </optgroup>
              </select>
              ${hasDuplicates ? `
                <div style="font-size: 11px; color: #FF6D00; margin-top: 6px;">
                  ⚠️ = Potential duplicate based on name similarity
                </div>
              ` : ''}
            </div>
            
                       <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box;">
              <span style="font-size: 12px; color: #666; white-space: nowrap;">New kennel name:</span>
              <input type="text" 
                     class="edit-kennel-name" 
                     value="${this.escapeHtml(canonicalName)}"
                     placeholder="Enter name for new kennel"
                     style="
                       width: 100%;
                       max-width: 100%;
                       padding: 10px 12px;
                       border: 1px solid #ddd;
                       border-radius: 6px;
                       font-size: 14px;
                       box-sizing: border-box;
                     ">
            </div>
            
            <div style="display: flex; gap: 8px; margin-top: 4px;">
              <button class="approve-new-kennel-btn" 
                      data-request-id="${requestId}"
                      data-original-country="${this.escapeHtml(requesterCountry)}"
                      data-original-state="${this.escapeHtml(requesterState)}"
                      data-requester-uid="${this.escapeHtml(requesterUid)}"
                      style="
                        flex: 1;
                        padding: 12px 16px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                      ">✓ Approve</button>
              
              <button class="deny-new-kennel-btn" 
                      data-request-id="${requestId}"
                      data-requester-uid="${this.escapeHtml(requesterUid)}"
                      style="
                        flex: 1;
                        padding: 12px 16px;
                        background: #f5f5f5;
                        color: #666;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                      ">✕ Deny</button>
            </div>
          </div>
        `;
      })).then(htmlArray => htmlArray.join(''));
      
      // Attach dynamic location change handlers
      listContainer.querySelectorAll('.new-kennel-request-item').forEach(item => {
        const countrySelect = item.querySelector('.correct-country');
        const stateSelect = item.querySelector('.correct-state');
        const kennelSelect = item.querySelector('.existing-kennel-select');
        const requestId = item.dataset.requestId;
        
        // Country change -> load states
        countrySelect.addEventListener('change', async () => {
          stateSelect.innerHTML = '<option value="">Select State</option>';
          stateSelect.disabled = true;
          kennelSelect.innerHTML = '<option value="" selected>-- Create NEW kennel --</option>';
          
          if (countrySelect.value) {
            try {
              let states;
              const cacheKey = countrySelect.value;
              if (this.cache.states[cacheKey]) {
                states = this.cache.states[cacheKey];
              } else {
                const statesSnap = await getDocs(collection(db, 'locations', countrySelect.value, 'states'));
                states = statesSnap.docs.map(d => d.id).sort();
                this.cache.states[cacheKey] = states;
              }
              
              stateSelect.innerHTML = '<option value="">Select State</option>' + 
                states.map(s => `<option value="${this.escapeHtml(s)}">${this.escapeHtml(s)}</option>`).join('');
              stateSelect.disabled = false;
            } catch (e) {
              console.error('Error loading states:', e);
            }
          }
        });
        
        // State change -> load kennels
        stateSelect.addEventListener('change', async () => {
          kennelSelect.innerHTML = '<option value="" selected>-- Create NEW kennel --</option>';
          
          if (countrySelect.value && stateSelect.value) {
            try {
              let kennels;
              const cacheKey = `${countrySelect.value}_${stateSelect.value}`;
              if (this.cache.kennels[cacheKey]) {
                kennels = this.cache.kennels[cacheKey];
              } else {
                const kennelsSnap = await getDocs(
                  collection(db, 'locations', countrySelect.value, 'states', stateSelect.value, 'kennels')
                );
                kennels = kennelsSnap.docs.map(d => ({
                  name: d.id,
                  path: `locations/${countrySelect.value}/states/${stateSelect.value}/kennels/${d.id}`
                }));
                this.cache.kennels[cacheKey] = kennels;
              }
              
              // Check for duplicates with current name
              const nameInput = item.querySelector('.edit-kennel-name');
              const currentName = nameInput.value.toLowerCase();
              const potentialDuplicates = kennels.filter(k => {
                const kennelLower = k.name.toLowerCase();
                const kennelWords = kennelLower.split(/\s+/);
                const requestWords = currentName.split(/\s+/);
                const hasWordOverlap = kennelWords.some(w => requestWords.includes(w) && w.length > 3);
                const contains = kennelLower.includes(currentName) || currentName.includes(kennelLower);
                return hasWordOverlap || contains;
              });
              
              const kennelOptions = kennels.map(k => {
                const isDuplicate = potentialDuplicates.some(d => d.path === k.path);
                const warning = isDuplicate ? ' ⚠️' : '';
                return `<option value="${this.escapeHtml(k.path)}">${this.escapeHtml(k.name)}${warning}</option>`;
              }).join('');
              
              kennelSelect.innerHTML = `
                <option value="" selected>-- Create NEW kennel (enter name below) --</option>
                <optgroup label="Existing Kennels (${kennels.length} found)">
                  ${kennelOptions || '<option value="" disabled>No kennels found</option>'}
                </optgroup>
              `;
              
              // Update warning text
              const warningDiv = item.querySelector('.existing-kennel-select').parentNode.querySelector('div:last-child');
              if (warningDiv && warningDiv.textContent.includes('⚠️')) {
                warningDiv.style.display = potentialDuplicates.length > 0 ? 'block' : 'none';
              } else if (potentialDuplicates.length > 0) {
                const warningHtml = `<div style="font-size: 11px; color: #FF6D00; margin-top: 6px;">⚠️ = Potential duplicate based on name similarity</div>`;
                kennelSelect.insertAdjacentHTML('afterend', warningHtml);
              }
              
            } catch (e) {
              console.error('Error loading kennels:', e);
            }
          }
        });
      });
      
      // Attach approve/deny handlers
      listContainer.querySelectorAll('.approve-new-kennel-btn').forEach(btn => {
        btn.onclick = async () => {
          const requestId = btn.dataset.requestId;
          const originalCountry = btn.dataset.originalCountry;
          const originalState = btn.dataset.originalState;
          const requesterUid = btn.dataset.requesterUid;
          const row = btn.closest('.new-kennel-request-item');
          
          // Get CORRECTED location (or use original if not changed)
          const countrySelect = row.querySelector('.correct-country');
          const stateSelect = row.querySelector('.correct-state');
          const finalCountry = countrySelect.value || originalCountry;
          const finalState = stateSelect.value || originalState;
          
          const nameInput = row.querySelector('.edit-kennel-name');
          const existingSelect = row.querySelector('.existing-kennel-select');
          
          const selectedExistingPath = existingSelect.value;
          const newKennelName = nameInput.value.trim();
          
          // Validation
          if (!finalCountry || !finalState) {
            alert('Please select both country and state');
            return;
          }
          
          if (!selectedExistingPath && !newKennelName) {
            alert('Please either select an existing kennel OR enter a new kennel name');
            return;
          }
          
          let finalName, existingKennelPath, targetCountry, targetState;
          
          targetCountry = finalCountry;
          targetState = finalState;
          
          if (selectedExistingPath) {
            // Using existing kennel - extract from path to ensure correct location
            const pathParts = selectedExistingPath.split('/');
            existingKennelPath = selectedExistingPath;
            finalName = pathParts[pathParts.length - 1];
            // Override with actual path location (in case admin picked different state)
            targetCountry = pathParts[1];
            targetState = pathParts[3];
          } else {
            // Creating new kennel in corrected location
            finalName = newKennelName;
            existingKennelPath = null;
          }
          
          await this.handleApproveNewKennel(requestId, targetCountry, targetState, finalName, requesterUid, overlay, existingKennelPath);
        };
      });
      
      listContainer.querySelectorAll('.deny-new-kennel-btn').forEach(btn => {
        btn.onclick = async () => {
          const requestId = btn.dataset.requestId;
          const requesterUid = btn.dataset.requesterUid;
          await this.handleDenyNewKennel(requestId, requesterUid, overlay);
        };
      });
      
    } catch (error) {
      console.error('Error loading new kennel requests:', error);
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #d32f2f;">
          <p>Error loading requests: ${error.message}</p>
        </div>
      `;
    }
  }

  async handleApproveNewKennel(requestId, country, state, finalCanonical, requesterUid, overlay, existingKennelPath = null) {
    try {
      // Show loading
      const btn = overlay.querySelector(`[data-request-id="${requestId}"].approve-new-kennel-btn`);
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Processing...';
      }
      
      // Get request data to find temp kennel name
      const requestDoc = await getDoc(doc(db, 'kennelRequests', requestId));
      const requestData = requestDoc.data();
      const canonicalName = requestData.canonicalName || requestData.requestedName || finalCanonical;
      const tempId = this.tempKennelName(canonicalName);
      
      const tempPath = `locations/${country}/states/${state}/kennels/${tempId}`;
      
      // Determine real kennel path - use existing if selected, otherwise create new
      let realPath;
      let realKennelName;
      
      if (existingKennelPath) {
        // Using existing kennel
        realPath = existingKennelPath;
        const pathParts = existingKennelPath.split('/');
        realKennelName = pathParts[pathParts.length - 1];
      } else {
        // Creating new kennel
        realPath = `locations/${country}/states/${state}/kennels/${finalCanonical}`;
        realKennelName = finalCanonical;
        
        const realRef = doc(db, 'locations', country, 'states', state, 'kennels', finalCanonical);
        
        // 1. Create/update real kennel doc (only for new kennels)
        await setDoc(realRef, {
          name: finalCanonical,
          country: country,
          state: state,
          createdAt: Timestamp.now(),
          status: 'active'
        }, { merge: true });
        
        // 5. Create/update designations doc (only for new kennels)
        const desRef = doc(db, 'designations', finalCanonical);
        const desSnap = await getDoc(desRef);
        if (!desSnap.exists()) {
          await setDoc(desRef, {
            createdAt: Timestamp.now()
          });
        }
      }
      
      const tempRef = doc(db, 'locations', country, 'states', state, 'kennels', tempId);
      
      // 2. Delete temp kennel doc (if exists)
      try {
        await deleteDoc(tempRef);
      } catch (e) {
        console.log('No temp kennel to delete');
      }
      
      // 3. Update users who have temp path in joinedKennels
      const usersQuery = query(collection(db, 'users'), where('joinedKennels', 'array-contains', tempPath));
      const usersSnap = await getDocs(usersQuery);
      
      for (const userDoc of usersSnap.docs) {
        const userRef = userDoc.ref;
        // Remove temp path
        await updateDoc(userRef, {
          joinedKennels: arrayRemove(tempPath)
        });
        // Add real path
        await updateDoc(userRef, {
          joinedKennels: arrayUnion(realPath)
        });
        // Update kennel field if it matches temp
        const userData = userDoc.data();
        if (userData.kennel === tempId) {
          await updateDoc(userRef, { kennel: realKennelName });
        }
      }
      
      // Also ensure the requester is added to the kennel (in case they weren't in temp)
      if (requesterUid) {
        const requesterRef = doc(db, 'users', requesterUid);
        const requesterSnap = await getDoc(requesterRef);
        if (requesterSnap.exists()) {
          const requesterData = requesterSnap.data();
          const currentJoined = requesterData.joinedKennels || [];
          if (!currentJoined.includes(realPath)) {
            await updateDoc(requesterRef, {
              joinedKennels: arrayUnion(realPath)
            });
          }
          // If they don't have a default kennel set, set this as default
          if (!requesterData.kennel) {
            await updateDoc(requesterRef, { 
              kennel: realKennelName,
              country: country,
              state: state
            });
          }
        }
      }
      
      // 4. Mark request as approved
      await updateDoc(doc(db, 'kennelRequests', requestId), {
        status: 'approved',
        finalName: realKennelName,
        kennelPath: realPath,
        isExistingKennel: !!existingKennelPath,
        approvedAt: Timestamp.now(),
        approvedBy: this.currentUser.uid
      });
      
      // Show success and reload
      const message = existingKennelPath 
        ? `Approved! User added to existing kennel "${realKennelName}".`
        : `Approved! New kennel "${realKennelName}" created.`;
      alert(message);
      
      // Reset played count so new requests trigger sound again
      this.lastPlayedCounts.new_kennel_requests = Math.max(0, (this.unreadMap.new_kennel_requests || 0) - 1);
      
      this.loadNewKennelRequests(overlay);
      
    } catch (error) {
      console.error('Error approving kennel:', error);
      alert('Error: ' + error.message);
    }
  }

  async handleDenyNewKennel(requestId, requesterUid, overlay) {
    try {
      // Get requester info for decline dialog
      const requesterDoc = await getDoc(doc(db, 'users', requesterUid));
      const requesterData = requesterDoc.data() || {};
      const handle = requesterData.hashHandle || requesterUid;
      const phone = requesterData.phone || '';
      
      // Show decline reason dialog (similar to Android's DeclineHelper)
      const reason = prompt(`Decline kennel request from ${handle}?\n\nEnter reason (optional):`);
      
      if (reason === null) {
        // User cancelled
        return;
      }
      
      // Update request status to declined
      await updateDoc(doc(db, 'kennelRequests', requestId), {
        status: 'declined',
        declinedAt: Timestamp.now(),
        declinedBy: this.currentUser.uid,
        declineReason: reason || ''
      });
      
      // Optional: Send notification to requester
      await this.sendDeclineNotification(requesterUid, reason);
      
          // Show success and reload
      alert('Request declined');
      
            // Reset played count so new requests trigger sound again
      this.lastPlayedCounts.new_kennel_requests = Math.max(0, (this.unreadMap.new_kennel_requests || 0) - 1);
      
      this.loadNewKennelRequests(overlay);
      
    } catch (error) {
      console.error('Error declining kennel:', error);
      alert('Error: ' + error.message);
    }
  }

  async sendDeclineNotification(userUid, reason) {
    try {
      const notificationRef = doc(db, 'users', userUid, 'notifications', `kennel_declined_${Date.now()}`);
      await setDoc(notificationRef, {
        type: 'kennel_declined',
        title: 'Kennel Request Declined',
        body: reason ? `Your kennel request was declined. Reason: ${reason}` : 'Your kennel request was declined.',
        timestamp: Timestamp.now(),
        read: false
      });
    } catch (e) {
      console.error('Notification error:', e);
    }
  }

  // Helper: Generate temp kennel name (matches Android)
  tempKennelName(requested) {
    // Create a hash code similar to Java's hashCode()
    let hash = 0;
    for (let i = 0; i < requested.length; i++) {
      const char = requested.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to unsigned and then to base 36
    const unsignedHash = hash >>> 0;
    const base36 = unsignedHash.toString(36).toUpperCase();
    return `PENDING-${base36}`;
  }

  // NEW: Setup mutual exclusion between Grand Master and Hash Master
  setupMutualExclusion(overlay) {
    const grandMasterCheckbox = overlay.querySelector('#new-GrandMaster');
    const hashMasterCheckbox = overlay.querySelector('#new-HashMaster');
    
    if (!grandMasterCheckbox || !hashMasterCheckbox) return;
    
    grandMasterCheckbox.onchange = () => {
      if (grandMasterCheckbox.checked) {
        hashMasterCheckbox.checked = false;
        hashMasterCheckbox.disabled = true;
        // Update visual state
        const hashMasterRow = hashMasterCheckbox.closest('div[style*="border: 1px solid"]');
        if (hashMasterRow) {
          hashMasterRow.style.opacity = '0.5';
          hashMasterRow.style.backgroundColor = '#f5f5f5';
        }
        this.updateNewAdminInputs(overlay);
      } else {
        hashMasterCheckbox.disabled = false;
        // Restore visual state
        const hashMasterRow = hashMasterCheckbox.closest('div[style*="border: 1px solid"]');
        if (hashMasterRow) {
          hashMasterRow.style.opacity = '1';
          hashMasterRow.style.backgroundColor = 'white';
        }
      }
    };
    
    hashMasterCheckbox.onchange = () => {
      if (hashMasterCheckbox.checked) {
        grandMasterCheckbox.checked = false;
        grandMasterCheckbox.disabled = true;
        // Update visual state
        const grandMasterRow = grandMasterCheckbox.closest('div[style*="border: 1px solid"]');
        if (grandMasterRow) {
          grandMasterRow.style.opacity = '0.5';
          grandMasterRow.style.backgroundColor = '#f5f5f5';
        }
        this.updateNewAdminInputs(overlay);
      } else {
        grandMasterCheckbox.disabled = false;
        // Restore visual state
        const grandMasterRow = grandMasterCheckbox.closest('div[style*="border: 1px solid"]');
        if (grandMasterRow) {
          grandMasterRow.style.opacity = '1';
          grandMasterRow.style.backgroundColor = 'white';
        }
      }
    };
  }
  
  async initKennelAdminDialog(overlay, isTier1, adminKennels, hasMultipleKennels) {
    const kennelSelect = overlay.querySelector('#admin-kennel-select');
    const prevAdminsList = overlay.querySelector('#prev-admins-list');
    
    if (isTier1) {
      // Tier 1: Load countries and show location selectors
      const tier1Selectors = overlay.querySelector('#tier1-selectors');
      const countrySelect = overlay.querySelector('#admin-country');
      const stateSelect = overlay.querySelector('#admin-state');
      const kennelDropdown = overlay.querySelector('#admin-kennel');
      
      // Show selectors by default for Tier 1
      tier1Selectors.style.display = 'block';
      
      // Load countries
      const countriesSnap = await getDocs(collection(db, 'locations'));
      countriesSnap.docs.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = doc.id;
        countrySelect.appendChild(opt);
      });
      
      // Country/State/Kennel cascade for Tier 1
      countrySelect.onchange = async () => {
        stateSelect.innerHTML = '<option value="">Select State</option>';
        kennelDropdown.innerHTML = '<option value="">Select Kennel</option>';
        kennelDropdown.disabled = true;
        prevAdminsList.innerHTML = '<div style="color: #999; padding: 20px; text-align: center;">Select state and kennel to load admins</div>';
        
        if (countrySelect.value) {
          const statesSnap = await getDocs(collection(db, 'locations', countrySelect.value, 'states'));
          statesSnap.docs.forEach(doc => {
            const opt = document.createElement('option');
            opt.value = doc.id;
            opt.textContent = doc.id;
            stateSelect.appendChild(opt);
          });
          stateSelect.disabled = false;
        }
      };
      
      stateSelect.onchange = async () => {
        kennelDropdown.innerHTML = '<option value="">Select Kennel</option>';
        prevAdminsList.innerHTML = '<div style="color: #999; padding: 20px; text-align: center;">Select kennel to load admins</div>';
        
        if (stateSelect.value) {
          const kennelsSnap = await getDocs(collection(db, 'locations', countrySelect.value, 'states', stateSelect.value, 'kennels'));
          kennelsSnap.docs.forEach(doc => {
            const opt = document.createElement('option');
            opt.value = doc.id;
            opt.textContent = doc.id;
            kennelDropdown.appendChild(opt);
          });
          kennelDropdown.disabled = false;
        }
      };
      
      // Kennel dropdown change - load admins with spinner
      kennelDropdown.onchange = async () => {
        if (kennelDropdown.value) {
          // Show loading spinner
          prevAdminsList.innerHTML = `
            <div class="admin-loading">
              <div class="admin-loading-spinner"></div>
              <p>Loading current admins...</p>
            </div>
          `;
          await this.loadCurrentAdmins(countrySelect.value, stateSelect.value, kennelDropdown.value, prevAdminsList, overlay);
        }
      };
    } else {
              // Tier 2: Handle single or multiple kennels
      if (!hasMultipleKennels) {
        // Single kennel - auto-load with spinner
        const kennel = adminKennels[0];
        prevAdminsList.innerHTML = `
          <div class="admin-loading">
            <div class="admin-loading-spinner"></div>
            <p>Loading current admins...</p>
          </div>
        `;
        await this.loadCurrentAdmins(kennel.country, kennel.state, kennel.kennelName, prevAdminsList, overlay);
      } else {
        // Multiple kennels - dropdown change handler
        const kennelSelect = overlay.querySelector('#admin-kennel-select');
        kennelSelect.onchange = async () => {
          const selectedPath = kennelSelect.value;
          const selected = adminKennels.find(k => k.kennelPath === selectedPath);
          if (selected) {
            // Show loading spinner
            prevAdminsList.innerHTML = `
              <div class="admin-loading">
                <div class="admin-loading-spinner"></div>
                <p>Loading current admins...</p>
              </div>
            `;
            await this.loadCurrentAdmins(selected.country, selected.state, selected.kennelName, prevAdminsList, overlay);
          }
        };
        
        // Auto-load first kennel with spinner
        if (adminKennels.length > 0) {
          kennelSelect.value = adminKennels[0].kennelPath;
          prevAdminsList.innerHTML = `
            <div class="admin-loading">
              <div class="admin-loading-spinner"></div>
              <p>Loading current admins...</p>
            </div>
          `;
          await this.loadCurrentAdmins(adminKennels[0].country, adminKennels[0].state, adminKennels[0].kennelName, prevAdminsList, overlay);
        }
      }
    }
    
    // Rest of initialization (select all, new admin inputs, role options, save)
    overlay.querySelector('#select-all').onchange = (e) => {
      const checked = e.target.checked;
      overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.id !== 'select-all') cb.checked = checked;
      });
      this.updateNewAdminInputs(overlay);
    };
    
    ['GrandMaster', 'HashMaster', 'ReligiousAdviser', 'OnSec'].forEach(role => {
      overlay.querySelector(`#new-${role}`).onchange = () => this.updateNewAdminInputs(overlay);
    });
    
    await this.loadRoleOptions(overlay);
    
    // Setup mutual exclusion
    this.setupMutualExclusion(overlay);
    
    overlay.querySelector('#save-admin').onclick = () => this.saveKennelAdminChanges(overlay, isTier1, adminKennels);
  }
  
  async loadRoleOptions(overlay) {
    // ADD THIS: Use cached users if available
    let users;
    if (this.cache.users) {
      users = this.cache.users;
    } else {
      // Load all users for the dropdown
      const usersQuery = query(collection(db, 'users'), orderBy('hashHandle', 'asc'));
      const usersSnap = await getDocs(usersQuery);
      
      users = usersSnap.docs.map(doc => ({
        id: doc.id,
        hashHandle: doc.data().hashHandle || 'Unknown',
        ...doc.data()
      }));
      
      this.cache.users = users; // Cache it
    }
    
    // Store users data for later use
    overlay.dataset.users = JSON.stringify(users);
    
    // Populate user dropdowns for new admins
    ['GrandMaster', 'HashMaster', 'ReligiousAdviser', 'OnSec'].forEach(roleId => {
      const select = overlay.querySelector(`#handle-${roleId}`);
      if (select) {
        select.innerHTML = '<option value="">Select Hash Handle</option>';
        users.forEach(user => {
          const opt = document.createElement('option');
          opt.value = user.hashHandle;
          opt.textContent = user.hashHandle;
          opt.dataset.userId = user.id;
          opt.dataset.phone = user.phone;
          select.appendChild(opt);
        });
      }
    });
    
    // Role is determined by checkbox, no role dropdown needed
    // Just store role names for reference
    const roleNames = ['Grand Master', 'Hash Master', 'Religious Adviser', 'On Sec'];
    overlay.dataset.roleNames = JSON.stringify(roleNames);
  }  // <-- ADD THIS CLOSING BRACE
  

  updateNewAdminInputs(overlay) {
    ['GrandMaster', 'HashMaster', 'ReligiousAdviser', 'OnSec'].forEach(roleId => {
      const checkbox = overlay.querySelector(`#new-${roleId}`);
      const handleInput = overlay.querySelector(`#handle-${roleId}`);
      
      if (checkbox && handleInput) {
        const isChecked = checkbox.checked;
        handleInput.disabled = !isChecked;
        
        if (!isChecked) {
          handleInput.value = '';
        }
      }
    });
  }

  async loadCurrentAdmins(country, state, kennel, container, overlay) {
    try {
      const designationsRef = doc(db, 'designations', kennel);
      const designationsSnap = await getDoc(designationsRef);
      
      let currentAdmins = {};
      if (designationsSnap.exists()) {
        currentAdmins = designationsSnap.data();
      }
      
      // Store current admins in overlay dataset for later use
      overlay.dataset.currentAdmins = JSON.stringify(currentAdmins);
      
      // ALWAYS show all 4 roles, even if unassigned
      const roles = ['Grand Master', 'Hash Master', 'Religious Adviser', 'On Sec'];
      
      // Fetch No Tier roles from Firestore for current admin section
      const noTierRoles = {};
      for (const roleName of roles) {
        try {
          const roleDoc = await getDoc(doc(db, 'roles', roleName));
          if (roleDoc.exists()) {
            const data = roleDoc.data();
            noTierRoles[roleName] = data['No Tier'] || [];
          } else {
            // Fallback to default if document doesn't exist
            noTierRoles[roleName] = ["DGM", "DHM", "PHM", "PGM", "EX GM", "EX HM", "DRA", "PRA", "EX RA", "Hasher"];
          }
        } catch (err) {
          console.error(`Error loading No Tier role ${roleName}:`, err);
          noTierRoles[roleName] = ["DGM", "DHM", "PHM", "PGM", "EX GM", "EX HM", "DRA", "PRA", "EX RA", "Hasher"];
        }
      }
      
      // Fetch user details for each admin phone number
      const adminDetails = await Promise.all(
        roles.map(async (role) => {
          const phone = currentAdmins[role];
          if (!phone) return { role, phone: null, hashHandle: null, unassigned: true };
          
          // Query users collection to find hash handle by phone
          const userQuery = query(collection(db, 'users'), where('phone', '==', phone));
          const userSnap = await getDocs(userQuery);
          const userData = userSnap.docs[0]?.data();
          
          return {
            role,
            phone,
            hashHandle: userData?.hashHandle || 'Unknown',
            userId: userSnap.docs[0]?.id,
            unassigned: false
          };
        })
      );
      
      container.innerHTML = adminDetails.map(admin => {
        // Show "Unassigned" for empty roles
        const displayText = admin.unassigned 
          ? '<span style="color: #999; font-style: italic;">Unassigned</span>' 
          : admin.hashHandle;
        
        // Checkbox enabled only if assigned, disabled if unassigned
        const checkboxDisabled = admin.unassigned ? 'disabled' : '';
        const checkboxStyle = admin.unassigned ? 'opacity: 0.3; cursor: not-allowed;' : '';
        
        // Build role options from No Tier array
        const roleOptions = (noTierRoles[admin.role] || []).map(r => 
          `<option value="${r}">${r}</option>`
        ).join('');
        
        return `
          <div style="
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            ${admin.unassigned ? 'opacity: 0.7; background: #fafafa;' : ''}
          ">
            <input type="checkbox" 
                   id="prev-${admin.role.replace(/\s+/g, '')}" 
                   ${checkboxDisabled} 
                   style="width: 20px; height: 20px; ${checkboxStyle}">
            <div style="flex: 1;">
              <div style="font-weight: 500; margin-bottom: 4px;">${admin.role}</div>
              <div style="font-size: 14px; color: #666;">${displayText}</div>
            </div>
            <select id="prev-role-${admin.role.replace(/\s+/g, '')}" 
                    disabled 
                    style="
                      padding: 8px;
                      border: 1px solid #ddd;
                      border-radius: 4px;
                      font-size: 14px;
                    ">
              <option value="">Select New Role</option>
              ${roleOptions}
            </select>
          </div>
        `;
      }).join('');
      
      // Add change handlers for checkboxes (only for assigned admins)
      adminDetails.forEach(admin => {
        if (admin.unassigned) return;
        const checkbox = container.querySelector(`#prev-${admin.role.replace(/\s+/g, '')}`);
        const roleSelect = container.querySelector(`#prev-role-${admin.role.replace(/\s+/g, '')}`);
        if (checkbox && roleSelect) {
          checkbox.onchange = () => {
            roleSelect.disabled = !checkbox.checked;
            if (!checkbox.checked) roleSelect.value = '';
          };
        }
      });
      
    } catch (error) {
      console.error('Error loading current admins:', error);
      container.innerHTML = `<div style="color: #d32f2f; padding: 20px; text-align: center;">Error loading admins: ${error.message}</div>`;
    }
  }

  showUsersListDialog() {
    // Create dialog overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
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
      font-family: sans-serif;
    `;
    
    overlay.innerHTML = `
      <div class="users-dialog" style="
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
          <h2 style="margin: 0; font-size: 20px;">Users List</h2>
          <button id="close-users" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
          ">×</button>
        </div>
        
        <div id="users-list" style="
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        ">
          <div style="text-align: center; padding: 40px; color: #666;">
            Loading users...
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Close button handler
    overlay.querySelector('#close-users').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    
    // Load users
    this.loadUsersList(overlay);
  }

  async loadUsersList(overlay) {
    const listContainer = overlay.querySelector('#users-list');
    
    try {
      // Query all users ordered by hashHandle
      const usersQuery = query(
        collection(db, 'users'),
        orderBy('hashHandle', 'asc')
      );
      
      const snapshot = await getDocs(usersQuery);
      
      if (snapshot.empty) {
        listContainer.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #666;">
            <div style="font-size: 48px; margin-bottom: 16px;">👤</div>
            <p>No users found</p>
          </div>
        `;
        return;
      }
      
      // Update title with count
      const title = overlay.querySelector('h2');
      title.textContent = `Users List (${snapshot.size})`;
      
      // Process each user
      const userPromises = snapshot.docs.map(async (doc, index) => {
        const data = doc.data();
        const phone = data.phone || '';
        const status = await this.checkSubscriptionStatus(phone);
        
        return {
          index: index + 1,
          handle: data.hashHandle || 'Unknown',
          pic: data.profilePicUrl || '',
          phone: phone,
          status: status,
          uid: doc.id
        };
      });
      
      const users = await Promise.all(userPromises);
      
      // Render list
      listContainer.innerHTML = users.map(user => {
        const statusColor = user.status === 'Premium_monthly' ? '#4CAF50' : 
                           user.status === 'Expired' ? '#d32f2f' : '#666';
        
        return `
          <div class="user-item" style="
            display: flex;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid #eee;
            gap: 12px;
          ">
            <div style="
              width: 24px;
              text-align: center;
              font-size: 14px;
              color: #999;
              font-weight: 500;
            ">${user.index}</div>
            
            <img src="${user.pic}" 
                 alt="${user.handle}" 
                 style="
                   width: 48px;
                   height: 48px;
                   border-radius: 50%;
                   object-fit: cover;
                   border: 2px solid #e0e0e0;
                 "
                 onerror="this.src='${this.createPlaceholder(user.handle)}'">
            
            <div style="flex: 1; min-width: 0;">
              <div style="
                font-weight: 600;
                font-size: 16px;
                color: #333;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              ">${this.escapeHtml(user.handle)}</div>
              <div style="
                font-size: 12px;
                color: #999;
                margin-top: 2px;
              ">${user.phone || 'No phone'}</div>
            </div>
            
            <div style="
              font-size: 12px;
              font-weight: 500;
              color: ${statusColor};
              padding: 4px 8px;
              background: ${statusColor}15;
              border-radius: 12px;
              white-space: nowrap;
            ">${user.status}</div>
          </div>
        `;
      }).join('');
      
    } catch (error) {
      console.error('Error loading users:', error);
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #d32f2f;">
          <p>Error loading users: ${error.message}</p>
        </div>
      `;
    }
  }

  async checkSubscriptionStatus(phone) {
    if (!phone) return 'No user';
    
    try {
      const userQuery = query(
        collection(db, 'users'),
        where('phone', '==', phone)
      );
      
      const snapshot = await getDocs(userQuery);
      const doc = snapshot.docs[0];
      
      if (!doc) return 'No user';
      
      const data = doc.data();
      const active = data.subscriptionActive || false;
      const sku = data.subscriptionSku || '';
      const expires = data.subscriptionExpiresAt || 0;
      
      if (!active) return 'Expired';
      if (sku === 'app_monthly_sub') return 'Premium_monthly';
      return 'Free';
      
    } catch (error) {
      console.error('Error checking subscription:', error);
      return 'Unknown';
    }
  }

  showPaymentRequestsDialog() {
    window.location.href = 'payment-requests.html';
  }

  showPaymentListDialog() {
    const dialog = new PaymentListDialog(
      this.userCountry,
      this.userState,
      this.userKennel,
      db
    );
    dialog.show();
  }

  async logout() {
    // Clean up all listeners
    this.cleanupListeners();
    
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.walletUnsubscribe) {
      this.walletUnsubscribe();
      this.walletUnsubscribe = null;
    }
	
	    // Clean up kennel wallet listener
    if (this.kennelWalletUnsubscribe) {
      this.kennelWalletUnsubscribe();
      this.kennelWalletUnsubscribe = null;
    }
    
    await signOut(auth);
    window.location.href = 'login.html';
  }

  navigateTo(screen) {
    switch(screen) {
      case 'runs':
        window.location.href = 'runs.html';
        break;
      case 'events':
        window.location.href = 'events.html';
        break;
      case 'songs':
        window.location.href = 'songs.html';
        break;
    }
  }

 

  toggleDayNight() {
    const isNight = localStorage.getItem('night_mode') === 'true';
    localStorage.setItem('night_mode', !isNight);
    document.body.classList.toggle('night-mode', !isNight);
  }

  showAboutHashDialog() {
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

async loadNextRun() {
  console.log('=== loadNextRun() START ===');
  
  if (!navigator.geolocation) {
    console.log('Geolocation not supported');
    this.updateNextRunUI(null, 'Geolocation not supported');
    return;
  }

  try {
    // Request permission
    const permission = await this.requestGeolocationPermission();
    if (!permission) {
      console.log('Location permission denied');
      this.updateNextRunUI(null, 'Location permission needed');
      return;
    }

    // Get current position
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });
    });

    const { latitude, longitude } = position.coords;
    console.log('GPS coordinates:', latitude, longitude);

    // Check for cached location first (less than 1 hour old)
    let state = null;
    let country = null;
    const CACHE_DURATION = 3600000; // 1 hour in milliseconds
    const cachedState = sessionStorage.getItem('cachedState');
    const cachedCountry = sessionStorage.getItem('cachedCountry');
    const cachedAt = parseInt(sessionStorage.getItem('cachedAt') || '0');
    const cacheAge = Date.now() - cachedAt;
    const cacheValid = cachedState && cacheAge < CACHE_DURATION;
    
    if (cacheValid) {
      // Use cached location
      state = cachedState;
      country = cachedCountry;
      console.log('Using cached location:', state, country, '(age:', Math.round(cacheAge/60000), 'minutes)');
    } else {
      // Cache expired or missing - get fresh location
      try {
        const reverseGeocode = httpsCallable(functions, 'reverseGeocode');
        const result = await reverseGeocode({ 
          latitude: latitude, 
          longitude: longitude 
        });
        
        state = result.data.state;
        country = result.data.country;
        
        console.log('Location detected from geocode:', state, country);
        
        // Save to cache
        sessionStorage.setItem('cachedState', state || '');
        sessionStorage.setItem('cachedCountry', country || '');
        sessionStorage.setItem('cachedAt', Date.now().toString());
        console.log('Location cached for 1 hour');
        
      } catch (geoError) {
        console.warn('Could not get location from GPS, using default kennel:', geoError);
        // Fall back to user's default location
        state = this.userState;
        country = this.userCountry;
        console.log('Using default location:', state, country);
      }
    }

    // DEBUG: Show what we're searching with
    console.log('Searching for runs in:', { state, country });
    console.log('User default kennel:', this.userKennel);
    console.log('User default state:', this.userState);
    console.log('User default country:', this.userCountry);

    // If we still don't have a state, use user's default
    if (!state) {
      console.log('No state from geocode, falling back to user default');
      state = this.userState;
      country = this.userCountry;
    }

    // Normalize state name (remove "State" suffix if present for matching)
    const stateVariations = this.generateStateVariations(state);
    console.log('State variations to search:', stateVariations);

    // Try to find runs - first try exact match, then variations
    let nextRun = null;
    
    for (const stateName of stateVariations) {
      if (!stateName) continue;
      
      console.log('Trying to find runs in state:', stateName);
      
      try {
        // Query runs in this state
        const runsQuery = query(
          collection(db, 'runs'),
          where('state', '==', stateName),
          where('date', '>=', new Date().toISOString().split('T')[0]),
          orderBy('date', 'asc'),
          orderBy('time', 'asc'),
          limit(1)
        );
        
        const runsSnap = await getDocs(runsQuery);
        
        if (!runsSnap.empty) {
          const runDoc = runsSnap.docs[0];
          nextRun = { id: runDoc.id, ...runDoc.data() };
          console.log('Found run:', nextRun);
          break; // Found one, stop searching
        } else {
          console.log('No runs found for state:', stateName);
        }
      } catch (queryError) {
        console.error('Error querying runs for', stateName, ':', queryError);
      }
    }

    // If no runs found in detected state, try user's default kennel
    if (!nextRun) {
      console.log('No runs found in detected state, checking default kennel:', this.userKennel);
      
      try {
        const defaultQuery = query(
          collection(db, 'runs'),
          where('kennel', '==', this.userKennel),
          where('state', '==', this.userState),
          where('date', '>=', new Date().toISOString().split('T')[0]),
          orderBy('date', 'asc'),
          orderBy('time', 'asc'),
          limit(1)
        );
        
        const defaultSnap = await getDocs(defaultQuery);
        
        if (!defaultSnap.empty) {
          nextRun = { id: defaultSnap.docs[0].id, ...defaultSnap.docs[0].data() };
          console.log('Found run in default kennel:', nextRun);
        } else {
          console.log('No runs in default kennel either');
        }
      } catch (defaultError) {
        console.error('Error querying default kennel:', defaultError);
      }
    }

    // Display result
    if (nextRun) {
      console.log('Displaying run:', nextRun);
      this.displayNextRun(nextRun);
    } else {
      console.log('No upcoming runs found anywhere');
      this.updateNextRunUI(null, 'No upcoming runs in your area');
    }

  } catch (error) {
    console.error('Error in loadNextRun:', error);
    this.updateNextRunUI(null, 'Could not load runs');
  }
  
  console.log('=== loadNextRun() END ===');
}

// NEW HELPER METHOD - Add this to the HomeManager class
generateStateVariations(stateName) {
  if (!stateName) return [];
  
  const variations = [stateName];
  
  // Add variation without "State" suffix
  if (stateName.endsWith(' State')) {
    variations.push(stateName.replace(' State', ''));
  } else {
    variations.push(stateName + ' State');
  }
  
  // Handle common variations
  const commonReplacements = {
    'Delta': ['Delta State'],
    'Lagos': ['Lagos State'],
    'Abuja': ['Federal Capital Territory', 'FCT', 'Abuja'],
    'FCT': ['Federal Capital Territory', 'Abuja'],
  };
  
  if (commonReplacements[stateName]) {
    variations.push(...commonReplacements[stateName]);
  }
  
  // Remove duplicates
  return [...new Set(variations)];
}

// NEW HELPER METHOD - Add this to the HomeManager class
displayNextRun(runData) {
  const title = runData.title || runData.name || 'Next Run';
  const date = runData.date || 'TBD';
  const time = runData.time || '';
  const kennel = runData.kennel || this.userKennel;
  const location = runData.location || runData.meetingPoint || 'Location TBD';
  
  // Format the display
  this.els.tvNextRunTitle.textContent = title;
  
  this.els.tvNextRunDetails.innerHTML = `
    <strong>${kennel}</strong> • ${date} ${time ? 'at ' + time : ''}
  `;
  
  this.els.tvNextRunSubDetails.textContent = location;
  
  // Make it clickable to view run details
  this.els.tvNextRunTitle.style.cursor = 'pointer';
  this.els.tvNextRunTitle.onclick = () => {
    window.location.href = `run-details.html?id=${runData.id}`;
  };
}

  // Helper method to get state from coordinates
  async getStateFromCoordinates(latitude, longitude) {
    try {
      const reverseGeocode = httpsCallable(functions, 'reverseGeocode');
      const result = await reverseGeocode({ 
        latitude: latitude, 
        longitude: longitude 
      });
      
      return {
        state: result.data.state,
        country: result.data.country
      };
    } catch (error) {
      console.warn('Reverse geocode failed:', error);
      return { state: null, country: null };
    }
  }

// ADD THIS NEW METHOD to HomeManager class
async requestGeolocationPermission() {
  // iOS Safari requires explicit permission request
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      
      if (result.state === 'granted') {
        return true;
      } else if (result.state === 'prompt') {
        // Will prompt user when we call getCurrentPosition
        return true;
      } else if (result.state === 'denied') {
        return false;
      }
      
      // Listen for permission changes
      result.onchange = () => {
        console.log('Geolocation permission changed to:', result.state);
      };
      
    } catch (e) {
      // Some browsers don't support permissions API, fall through to direct request
      console.log('Permissions API not supported, using direct geolocation');
    }
  }
  
  // Fallback: try to get position directly (triggers prompt on iOS)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (error) => {
        if (error.code === 1) {
          resolve(false); // Permission denied
        } else {
          resolve(true); // Other error, but permission might be granted
        }
      },
      { timeout: 5000 }
    );
  });
}

  // Helper method to update the Next Run UI
  updateNextRunUI(runData, stateOrMessage) {
    const titleEl = this.els.tvNextRunTitle;
    const detailsEl = this.els.tvNextRunDetails;
    const subDetailsEl = this.els.tvNextRunSubDetails;

    if (!runData) {
      // No run found or error
      titleEl.textContent = stateOrMessage || 'No upcoming runs';
      
      // Help text for permission issues
      if (stateOrMessage && stateOrMessage.includes('permission')) {
        detailsEl.innerHTML = `
          <span style="color: #FF6D00;">
            Please enable location in your device settings to see nearby runs
          </span>
        `;
      } else {
        detailsEl.textContent = '';
      }
      
      subDetailsEl.textContent = '';
      return;
    }

    // Run found - display it
    titleEl.textContent = runData.title || 'Next Run';
    detailsEl.textContent = runData.details || '';
    subDetailsEl.textContent = runData.subDetails || '';
  }
  
    // NEW: Kennel Wallet Methods
  
updateKennelWalletVisibility() {
  console.log('=== DEBUG: updateKennelWalletVisibility ===');
  console.log('userRole:', this.userRole);
  console.log('hasTier2Access:', this.hasTier2Access());
  console.log('userData?.country:', this.userData?.country);
  
  const isTier1 = this.hasTier1Access();
  const isTier2 = this.hasTier2Access();
    const country = this.userData?.country;
    
    const showKennelWallet = (isTier1 || isTier2) && country === 'Nigeria';
    
    if (!showKennelWallet || !this.els.kennelWalletSection) {
      console.log('HIDING kennel wallet. isTier1:', isTier1, 'isTier2:', isTier2, 'country:', country);
      if (this.els.kennelWalletSection) {
        this.els.kennelWalletSection.style.display = 'none';
      }
      return;
    }
    
    console.log('SHOWING kennel wallet');
    this.els.kennelWalletSection.style.display = 'flex';
    
    let adminKennels = [];
    
    if (isTier2) {
      // Tier 2: Get kennels from getAdminKennels()
      adminKennels = this.getAdminKennels();
    } else if (isTier1) {
      // Tier 1: Use their default kennel
      adminKennels = [{
        kennelPath: `locations/${this.userCountry}/states/${this.userState}/kennels/${this.userKennel}`,
        kennelName: this.userKennel,
        country: this.userCountry,
        state: this.userState,
        designation: this.userData?.designation || 'Admin',
        isDefault: true
      }];
    }
    
    console.log('adminKennels:', adminKennels);
    
    if (adminKennels.length === 0) {
      console.log('No admin kennels found, hiding');
      this.els.kennelWalletSection.style.display = 'none';
      return;
    }
    
    // Setup kennel selector if multiple kennels
    const kennelSelect = this.els.selKennelWallet;
    if (adminKennels.length > 1) {
      kennelSelect.style.display = 'inline-block';
      kennelSelect.innerHTML = '<option value="">Select Kennel</option>';
      
      adminKennels.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k.kennelPath;
        opt.textContent = k.kennelName;
        kennelSelect.appendChild(opt);
      });
      
      // Auto-select first kennel
      if (!kennelSelect.value && adminKennels.length > 0) {
        kennelSelect.value = adminKennels[0].kennelPath;
        this.loadKennelWallet(adminKennels[0].kennelPath);
      }
      
      // Change handler
      kennelSelect.onchange = () => {
        if (kennelSelect.value) {
          this.loadKennelWallet(kennelSelect.value);
        }
      };
    } else {
      kennelSelect.style.display = 'none';
      // Single kennel - auto load
      this.loadKennelWallet(adminKennels[0].kennelPath);
    }
    
    // Click handler to open dialog
    this.els.tvKennelWalletBalance.onclick = () => this.showKennelWalletDialog();
  }

  async loadKennelWallet(kennelPath) {
    try {
      this.currentKennelWallet = kennelPath;
      
      // Parse path: locations/{country}/states/{state}/kennels/{kennel}
      const parts = kennelPath.split('/');
      const country = parts[1];
      const state = parts[3];
      const kennel = parts[5];
      
      const walletRef = doc(db, 'locations', country, 'states', state, 'kennels', kennel, 'wallets', 'main');
      const walletSnap = await getDoc(walletRef);
      
      if (!walletSnap.exists()) {
        this.els.tvKennelWalletBalance.innerHTML = `<strong>Kennel Wallet:</strong> ₦0`;
        this.kennelWallets.set(kennelPath, { total: 0, breakdown: {} });
        return;
      }
      
      const data = walletSnap.data();
      const breakdown = {
        accommodation: data.accommodationWallet?.totalAmount || 0,
        rego: data.regoWallet?.totalAmount || 0,
        sponsorship: data.sponsorshipWallet?.totalAmount || 0
      };
      
      const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
      
      this.kennelWallets.set(kennelPath, { total, breakdown, data });
      
      this.els.tvKennelWalletBalance.innerHTML = `<strong>Kennel Wallet:</strong> ₦${total.toLocaleString()}`;
      
      // Start real-time listener
      this.startKennelWalletListener(kennelPath, walletRef);
      
    } catch (error) {
      console.error('Error loading kennel wallet:', error);
      this.els.tvKennelWalletBalance.innerHTML = `<strong>Kennel Wallet:</strong> Error`;
    }
  }

  startKennelWalletListener(kennelPath, walletRef) {
    // Unsubscribe previous if exists
    if (this.kennelWalletUnsubscribe) {
      this.kennelWalletUnsubscribe();
    }
    
    this.kennelWalletUnsubscribe = onSnapshot(walletRef, (snap) => {
      if (!snap.exists()) return;
      
      const data = snap.data();
      const breakdown = {
        accommodation: data.accommodationWallet?.totalAmount || 0,
        rego: data.regoWallet?.totalAmount || 0,
        sponsorship: data.sponsorshipWallet?.totalAmount || 0
      };
      
      const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
      this.kennelWallets.set(kennelPath, { total, breakdown, data });
      
      // Only update UI if this is the currently selected kennel
      if (this.currentKennelWallet === kennelPath) {
        this.els.tvKennelWalletBalance.innerHTML = `<strong>Kennel Wallet:</strong> ₦${total.toLocaleString()}`;
      }
    }, (error) => {
      console.error('Kennel wallet listener error:', error);
    });
    
    // Store for cleanup
    this.unsubscribers.push(this.kennelWalletUnsubscribe);
  }

   showKennelWalletDialog() {
    const kennelPath = this.currentKennelWallet;
    if (!kennelPath) return;
    
    const walletData = this.kennelWallets.get(kennelPath);
    
    // FIX: Handle missing wallet or zero balance
    if (!walletData || !walletData.breakdown) {
      alert('No wallet data available for this kennel. Wallet may not be set up yet.');
      return;
    }
    
    const { total = 0, breakdown = {} } = walletData;
    
   // const { total, breakdown } = walletData;
    
    // Parse kennel name for display
    const parts = kennelPath.split('/');
    const kennelName = parts[5];
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
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
      font-family: sans-serif;
    `;
    
   overlay.innerHTML = `
  <div class="kennel-wallet-dialog">
    <div style="
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #e0e0e0;
      background: #FF6D00;
    ">
      <h2 style="margin: 0; font-size: 18px; color: white;">${kennelName} Wallet</h2>
      <button id="close-kennel-wallet" style="
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: white;
      ">×</button>
    </div>
    
    <!-- WRAP middle content in scrollable container -->
    <div class="dialog-content">
      <div class="wallet-breakdown">
        <div class="wallet-item" data-type="accommodation">
          <div class="wallet-name">
            <input type="checkbox" class="wallet-checkbox" id="chk-accommodation" ${breakdown.accommodation > 0 ? '' : 'disabled'}>
            🏨 Accommodation
          </div>
          <div class="wallet-amount">₦${breakdown.accommodation.toLocaleString()}</div>
        </div>
        
        <div class="wallet-item" data-type="rego">
          <div class="wallet-name">
            <input type="checkbox" class="wallet-checkbox" id="chk-rego" ${breakdown.rego > 0 ? '' : 'disabled'}>
            🏃 Rego
          </div>
          <div class="wallet-amount">₦${breakdown.rego.toLocaleString()}</div>
        </div>
        
        <div class="wallet-item" data-type="sponsorship">
          <div class="wallet-name">
            <input type="checkbox" class="wallet-checkbox" id="chk-sponsorship" ${breakdown.sponsorship > 0 ? '' : 'disabled'}>
            🤝 Sponsorship
          </div>
          <div class="wallet-amount">₦${breakdown.sponsorship.toLocaleString()}</div>
        </div>
      </div>
      
      <div class="grand-total">
        <div class="grand-total-label">Total Available</div>
        <div class="grand-total-amount">₦${total.toLocaleString()}</div>
      </div>
    </div>
    
    <div class="withdraw-section">
      <div class="withdraw-toggle">
        <button id="btn-withdraw-all" class="active">Withdraw All</button>
        <button id="btn-withdraw-select">Select Wallets</button>
      </div>
      
      <div class="bank-form">
        <div class="form-group">
          <label>Bank Name</label>
        <select id="withdraw-bank">
  <option value="">Select Bank</option>
  <option value="044">Access Bank</option>
  <option value="023">Citibank Nigeria</option>
  <option value="050">Ecobank Nigeria</option>
  <option value="070">Fidelity Bank</option>
  <option value="011">First Bank of Nigeria</option>
  <option value="214">First City Monument Bank (FCMB)</option>
  <option value="058">Guaranty Trust Bank (GTB)</option>
  <option value="030">Heritage Bank</option>
  <option value="301">Jaiz Bank</option>
  <option value="082">Keystone Bank</option>
  <option value="101">Providus Bank</option>
  <option value="076">Polaris Bank</option>
  <option value="221">Stanbic IBTC Bank</option>
  <option value="068">Standard Chartered Bank</option>
  <option value="232">Sterling Bank</option>
  <option value="100">SunTrust Bank</option>
  <option value="032">Union Bank of Nigeria</option>
  <option value="033">United Bank for Africa (UBA)</option>
  <option value="215">Unity Bank</option>
  <option value="035">Wema Bank</option>
  <option value="057">Zenith Bank</option>
  <!-- Fintech/Mobile Money -->
  <option value="120">9 Payment Service Bank (9PSB)</option>
  <option value="999991">Kuda Bank</option>
  <option value="999992">Opay</option>
  <option value="999993">Palmpay</option>
  <option value="999994">Moniepoint</option>
  <option value="999995">Paga</option>
  <option value="999996">Carbon</option>
  <option value="999997">FairMoney</option>
  <option value="999998">Branch</option>
  <option value="999999">Bamboo</option>
</select>
        </div>
        
        <div class="form-group">
          <label>Account Number</label>
          <input type="text" id="withdraw-account" placeholder="10 digit account number" maxlength="10">
        </div>
        
        <div class="form-group">
          <label>Account Holder Name</label>
          <input type="text" id="withdraw-holder" placeholder="Name on account">
        </div>
        
        <div class="form-group">
          <label>Amount to Withdraw (₦)</label>
          <input type="number" id="withdraw-amount" class="amount-input" placeholder="0" min="100" max="${Math.min(total, 1000000)}">
        </div>
        
        <div class="error-message" id="withdraw-error"></div>
        
        <button id="btn-submit-withdraw" class="withdraw-btn" disabled>Withdraw Funds</button>
      </div>
    </div>
  </div>
`;
    
    document.body.appendChild(overlay);
    
    // Close handler
    overlay.querySelector('#close-kennel-wallet').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    
    // Toggle handlers
    const btnWithdrawAll = overlay.querySelector('#btn-withdraw-all');
    const btnWithdrawSelect = overlay.querySelector('#btn-withdraw-select');
    const amountInput = overlay.querySelector('#withdraw-amount');
    
    let withdrawMode = 'all'; // 'all' or 'select'
    let selectedWallets = ['accommodation', 'rego', 'sponsorship'];
    
    btnWithdrawAll.onclick = () => {
      withdrawMode = 'all';
      btnWithdrawAll.classList.add('active');
      btnWithdrawSelect.classList.remove('active');
      
      // Select all checkboxes
      overlay.querySelectorAll('.wallet-checkbox:not(:disabled)').forEach(chk => {
        chk.checked = true;
        chk.closest('.wallet-item').classList.add('selected');
      });
      
      // Set amount to total
      amountInput.value = total;
      updateMaxAmount(total);
    };
    
    btnWithdrawSelect.onclick = () => {
      withdrawMode = 'select';
      btnWithdrawSelect.classList.add('active');
      btnWithdrawAll.classList.remove('active');
		  selectedWallets = []; // ADD THIS LINE
      
      // Uncheck all
      overlay.querySelectorAll('.wallet-checkbox').forEach(chk => {
        chk.checked = false;
        chk.closest('.wallet-item').classList.remove('selected');
      });
      
      amountInput.value = '';
      updateMaxAmount(0);
    };
    
    // Checkbox handlers
    overlay.querySelectorAll('.wallet-checkbox:not(:disabled)').forEach(chk => {
      chk.onchange = () => {
        const walletItem = chk.closest('.wallet-item');
        const walletType = walletItem.dataset.type;
        
        if (chk.checked) {
          walletItem.classList.add('selected');
          if (!selectedWallets.includes(walletType)) {
            selectedWallets.push(walletType);
          }
        } else {
          walletItem.classList.remove('selected');
          selectedWallets = selectedWallets.filter(w => w !== walletType);
        }
        
        // Calculate max from selected
        const selectedTotal = selectedWallets.reduce((sum, type) => sum + breakdown[type], 0);
        updateMaxAmount(selectedTotal);
        
        // Update amount if it exceeds new max
        if (parseInt(amountInput.value) > selectedTotal) {
          amountInput.value = selectedTotal;
        }
      };
    });
    
    function updateMaxAmount(max) {
      amountInput.max = Math.min(max, 1000000);
      const effectiveMax = Math.min(max, 1000000);
      amountInput.placeholder = `Max: ₦${effectiveMax.toLocaleString()}`;
    }
    
    // Initialize with all selected
    btnWithdrawAll.click();
    
    // Form validation
    const bankSelect = overlay.querySelector('#withdraw-bank');
    const accountInput = overlay.querySelector('#withdraw-account');
    const holderInput = overlay.querySelector('#withdraw-holder');
    const submitBtn = overlay.querySelector('#btn-submit-withdraw');
    const errorDiv = overlay.querySelector('#withdraw-error');
    
    function validateForm() {
      const hasBank = bankSelect.value !== '';
      const hasAccount = accountInput.value.length === 10;
      const hasHolder = holderInput.value.trim().length > 0;
      const amount = parseInt(amountInput.value);
      const hasValidAmount = amount >= 100 && amount <= Math.min(total, 1000000);
      
      const isValid = hasBank && hasAccount && hasHolder && hasValidAmount;
      submitBtn.disabled = !isValid;
      
      return isValid;
    }
    
    [bankSelect, accountInput, holderInput, amountInput].forEach(el => {
      el.oninput = () => {
        validateForm();
        errorDiv.style.display = 'none';
      };
    });
    
    // Submit handler
    submitBtn.onclick = async () => {
      if (!validateForm()) return;
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing...';
	  
	   // FIX: Define parts here
      const parts = kennelPath.split('/');
      
      const withdrawFrom = withdrawMode === 'all' ? 'all' : selectedWallets;
      
      try {
        const withdrawFn = httpsCallable(functions, 'withdrawKennelFunds');
        
        const result = await withdrawFn({
          country: parts[1],
          state: parts[3],
          kennel: parts[5],
          amount: parseInt(amountInput.value),
          bankDetails: {
            accountNumber: accountInput.value,
            bankCode: bankSelect.value,
            bankName: bankSelect.options[bankSelect.selectedIndex].text,
            accountName: holderInput.value.trim()
          },
          withdrawFrom: withdrawFrom
        });
        
        if (result.data.success) {
          alert(`✅ Withdrawal request submitted. Check your DMs for confirmation within 5-10 minutes.!\nReference: ${result.data.transferReference}`);
          overlay.remove();
        } else {
          throw new Error(result.data.message || 'Withdrawal failed');
        }
        
      } catch (error) {
        console.error('Withdrawal error:', error);
        errorDiv.textContent = error.message || 'Withdrawal failed. Please try again.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Withdraw Funds';
      }
    };
  }

}


// PaymentListDialog class
class PaymentListDialog {
  constructor(userCountry, userState, userKennel, db) {
    this.userCountry = userCountry;
    this.userState = userState;
    this.userKennel = userKennel;
    this.db = db;
    this.dateFmt = new Intl.DateTimeFormat('en-CA');
    this.today = this.dateFmt.format(new Date());
    this.availableDates = {
      runs: [],
      events: []
    };
  }

  async show() {
    console.log('PaymentListDialog SHOW');

    // Pre-load available dates for the calendar
    await this.loadAvailableDates();

    const dialogHTML = `
      <h2>Payment List</h2>
      
      <!-- Main Tabs -->
      <div class="tabs">
        <button class="tab-btn active" data-tab="run">Run</button>
        <button class="tab-btn" data-tab="event">Event</button>
      </div>
      
      <!-- Run Tab -->
      <div id="tab-run" class="tab-content active">
        <div class="date-picker">
          <button id="btnRunDate" class="date-picker-btn">📅 ${this.today}</button>
        </div>
        
        <!-- Run Sub-tabs -->
        <div class="sub-tabs">
          <button class="sub-tab-btn active" data-subtab="run-rego">Rego</button>
          <button class="sub-tab-btn" data-subtab="run-spon">Sponsorship</button>
        </div>
        
        <div id="run-rego-content" class="sub-tab-content active">
          <div id="runRegoContainer">Select a date to view rego payments</div>
        </div>
        <div id="run-spon-content" class="sub-tab-content">
          <div id="runSponContainer">Select a date to view sponsorship payments</div>
        </div>
      </div>
      
      <!-- Event Tab -->
      <div id="tab-event" class="tab-content">
        <div class="date-picker">
          <button id="btnEventDate" class="date-picker-btn">📅 ${this.today}</button>
        </div>
        
        <!-- Event Sub-tabs -->
        <div class="sub-tabs">
          <button class="sub-tab-btn active" data-subtab="event-rego">Rego</button>
          <button class="sub-tab-btn" data-subtab="event-acc">Accommodation</button>
          <button class="sub-tab-btn" data-subtab="event-spon">Sponsorship</button>
        </div>
        
        <div id="event-rego-content" class="sub-tab-content active">
          <div id="eventRegoContainer">Select a date to view event rego payments</div>
        </div>
        <div id="event-acc-content" class="sub-tab-content">
          <div id="eventAccContainer">Select a date to view accommodation bookings</div>
        </div>
        <div id="event-spon-content" class="sub-tab-content">
          <div id="eventSponContainer">Select a date to view sponsorships</div>
        </div>
      </div>
      
      <div class="dialog-buttons">
        <button id="btnClosePaymentList" class="btn-secondary">Close</button>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'payment-list-overlay';
    overlay.innerHTML = `<div class="payment-list-dialog">${dialogHTML}</div>`;
    document.body.appendChild(overlay);

    // Cache containers
    this.containers = {
      runRego: overlay.querySelector('#runRegoContainer'),
      runSpon: overlay.querySelector('#runSponContainer'),
      eventRego: overlay.querySelector('#eventRegoContainer'),
      eventAcc: overlay.querySelector('#eventAccContainer'),
      eventSpon: overlay.querySelector('#eventSponContainer')
    };

    // Setup main tabs
    this.setupMainTabs(overlay);
    
    // Setup sub-tabs
    this.setupSubTabs(overlay);
    
    // Setup date pickers with calendar
    this.setupDatePickers(overlay);

    // Load initial data
    await this.loadRunData(this.today);
    await this.loadEventData(this.today);

    // Close button
    overlay.querySelector('#btnClosePaymentList').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  }

  async loadAvailableDates() {
    try {
      // Get run dates from runsHistory via paymentRequests
      const runPayQuery = query(
        collection(this.db, 'paymentRequests'),
        where('kennel', '==', this.userKennel),
        where('type', '==', 'run-payment')
      );
      const runPaySnaps = await getDocs(runPayQuery);
      
      const runDates = new Set();
      for (const payDoc of runPaySnaps.docs) {
        const payData = payDoc.data();
        let date = payData.runDate;
        if (!date && payData.historyId) {
          const runDoc = await getDoc(doc(this.db, 'runsHistory', payData.historyId));
          if (runDoc.exists()) {
            date = runDoc.data().date;
          }
        }
        if (date) runDates.add(date);
      }
      this.availableDates.runs = [...runDates];

      // Get event dates from events via paymentRequests
      const eventPayQuery = query(
        collection(this.db, 'paymentRequests'),
        where('kennel', '==', this.userKennel),
        where('type', '==', 'event-payment')
      );
      const eventPaySnaps = await getDocs(eventPayQuery);
      
      const eventDates = new Set();
      for (const payDoc of eventPaySnaps.docs) {
        const eventId = payDoc.data().eventId;
        if (!eventId) continue;
        
        const eventDoc = await getDoc(doc(this.db, 'events', eventId));
        if (eventDoc.exists()) {
          const startDate = eventDoc.data().startDate;
          if (startDate) eventDates.add(startDate);
        }
      }
      this.availableDates.events = [...eventDates];
      
    } catch (err) {
      console.error('Error loading available dates:', err);
    }
  }

  setupMainTabs(dialog) {
    const tabBtns = dialog.querySelectorAll('.tab-btn');
    const tabContents = dialog.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
      btn.onclick = () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tabName = btn.dataset.tab;
        tabContents.forEach(content => {
          content.classList.toggle('active', content.id === `tab-${tabName}`);
        });
      };
    });
  }

  setupSubTabs(dialog) {
    const subTabBtns = dialog.querySelectorAll('.sub-tab-btn');
    
    subTabBtns.forEach(btn => {
      btn.onclick = () => {
        // Find parent tab content
        const parentTab = btn.closest('.tab-content');
        
        // Update active states within this parent only
        parentTab.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const subtabName = btn.dataset.subtab;
        parentTab.querySelectorAll('.sub-tab-content').forEach(content => {
          content.classList.toggle('active', content.id === `${subtabName}-content`);
        });
      };
    });
  }

  setupDatePickers(dialog) {
    // Run date picker
    dialog.querySelector('#btnRunDate').onclick = () => {
      this.showCalendar('run', (date) => {
        dialog.querySelector('#btnRunDate').textContent = `📅 ${date}`;
        this.loadRunData(date);
      });
    };

    // Event date picker
    dialog.querySelector('#btnEventDate').onclick = () => {
      this.showCalendar('event', (date) => {
        dialog.querySelector('#btnEventDate').textContent = `📅 ${date}`;
        this.loadEventData(date);
      });
    };
  }

  showCalendar(type, onSelect) {
    const overlay = document.createElement('div');
    overlay.className = 'calendar-overlay';
    
    const availableDates = type === 'run' ? this.availableDates.runs : this.availableDates.events;
    
    const now = new Date();
    let currentMonth = now.getMonth();
    let currentYear = now.getFullYear();
    
    const renderCalendar = () => {
      const firstDay = new Date(currentYear, currentMonth, 1).getDay();
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      const monthName = new Date(currentYear, currentMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      let html = `
        <div class="calendar-dialog">
          <div class="calendar-header">
            <button class="nav-btn" id="navPrev">‹</button>
            <span class="month-year">${monthName}</span>
            <button class="nav-btn" id="navNext">›</button>
          </div>
          <div class="calendar-grid">
            <div class="day-header">Su</div>
            <div class="day-header">Mo</div>
            <div class="day-header">Tu</div>
            <div class="day-header">We</div>
            <div class="day-header">Th</div>
            <div class="day-header">Fr</div>
            <div class="day-header">Sa</div>
      `;
      
      // Empty cells for days before start of month
      for (let i = 0; i < firstDay; i++) {
        html += '<div class="day empty"></div>';
      }
      
      // Days
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isAvailable = availableDates.includes(dateStr);
        const isToday = dateStr === this.today;
        const hasDataClass = isAvailable ? 'has-data' : '';
        const todayClass = isToday ? 'today' : '';
        
        html += `<div class="day ${hasDataClass} ${todayClass}" data-date="${dateStr}">${day}</div>`;
      }
      
      html += `
          </div>
          <div class="calendar-legend">
            <span class="legend-item"><span class="dot has-data"></span> Has payments</span>
            <span class="legend-item"><span class="dot today"></span> Today</span>
          </div>
          <button class="btn-close-calendar">Cancel</button>
        </div>
      `;
      
      return html;
    };
    
    const attachListeners = () => {
      // Navigation buttons - query from overlay, not document
      const navPrev = overlay.querySelector('#navPrev');
      const navNext = overlay.querySelector('#navNext');
      
      if (navPrev) {
        navPrev.onclick = () => {
          currentMonth--;
          if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
          }
          updateCalendar();
        };
      }
      
      if (navNext) {
        navNext.onclick = () => {
          currentMonth++;
          if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
          }
          updateCalendar();
        };
      }
      
      // Day selection
      overlay.querySelectorAll('.day[data-date]').forEach(day => {
        day.onclick = () => {
          const date = day.dataset.date;
          overlay.remove();
          onSelect(date);
        };
      });
      
      // Close button
      const closeBtn = overlay.querySelector('.btn-close-calendar');
      if (closeBtn) {
        closeBtn.onclick = () => overlay.remove();
      }
    };
    
    const updateCalendar = () => {
      overlay.innerHTML = renderCalendar();
      attachListeners();
    };
    
    // ADD TO DOM FIRST, then render
    document.body.appendChild(overlay);
    updateCalendar(); // Now this works because overlay is in the DOM
    
    // Overlay click to close
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
  }

  async loadRunData(date) {
    try {
      this.containers.runRego.innerHTML = 'Loading...';
      this.containers.runSpon.innerHTML = 'Loading...';

      const payQuery = query(
        collection(this.db, 'paymentRequests'),
        where('kennel', '==', this.userKennel),
        where('type', '==', 'run-payment'),
        where('runDate', '==', date)
      );

      const paySnaps = await getDocs(payQuery);
      
      const regoPayments = [];
      const sponPayments = [];

      for (const payDoc of paySnaps.docs) {
        const payData = payDoc.data();
        const uid = payData.userId;
        if (!uid) continue;

        const userDoc = await getDoc(doc(this.db, 'users', uid));
        const userData = userDoc.data() || {};
        const payerHandle = userData.hashHandle || 'Unknown';

        // Process Rego
        if (payData.regoSelf?.selected || (payData.regoOthers && payData.regoOthers.length > 0)) {
          const regoEntry = {
            payer: payerHandle,
            self: payData.regoSelf?.selected ? {
              amount: payData.regoSelf.amount || 0
            } : null,
            others: (payData.regoOthers || []).map(r => ({
              hashHandle: r.hashHandle,
              amount: r.amount || 0
            }))
          };
          regoPayments.push(regoEntry);
        }

        // Process Sponsorship
        if (payData.sponsorshipSelf?.selected || (payData.sponsorshipOthers && payData.sponsorshipOthers.length > 0)) {
          const sponEntry = {
            payer: payerHandle,
            self: payData.sponsorshipSelf?.selected ? {
              amount: payData.sponsorshipSelf.amount || 0
            } : null,
            others: (payData.sponsorshipOthers || []).map(s => ({
              hashHandle: s.hashHandle,
              amount: s.amount || 0
            }))
          };
          sponPayments.push(sponEntry);
        }
      }

      this.renderRunRego(regoPayments);
      this.renderRunSpon(sponPayments);

    } catch (err) {
      console.error('loadRunData error:', err);
      this.containers.runRego.innerHTML = `Error: ${err.message}`;
      this.containers.runSpon.innerHTML = `Error: ${err.message}`;
    }
  }

  renderRunRego(payments) {
    if (payments.length === 0) {
      this.containers.runRego.innerHTML = '<p class="no-data">No rego payments for this date.</p>';
      return;
    }

    // Calculate grand total
    const grandTotal = payments.reduce((sum, p) => {
      let total = 0;
      if (p.self) total += p.self.amount || 0;
      if (p.others) total += p.others.reduce((s, o) => s + (o.amount || 0), 0);
      return sum + total;
    }, 0);

    let html = '<div class="payment-section">';
    html += `<div class="grand-total">Grand Total: ₦${grandTotal.toLocaleString()}</div>`;
    
    payments.forEach((payment, idx) => {
      const number = idx + 1;
      html += `<div class="payer-card">`;
      html += `<div class="payer-header"><span class="payment-number" style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #FF6D00; color: white; border-radius: 50%; font-weight: bold; font-size: 14px; margin-right: 10px;">${number}</span>Payment <span class="payer-name">by ${payment.payer}</span></div>`;
      
      if (payment.self) {
        html += `
          <div class="payment-row self">
            <span class="label">Self:</span>
            <span class="hash-handle">${payment.payer}</span>
            <span class="amount">₦${payment.self.amount.toLocaleString()}</span>
          </div>
        `;
      }
      
      if (payment.others && payment.others.length > 0) {
        html += `<div class="others-section">`;
        html += `<div class="others-header">For Others:</div>`;
        payment.others.forEach(other => {
          html += `
            <div class="payment-row other">
              <span class="hash-handle">${other.hashHandle}</span>
              <span class="amount">₦${other.amount.toLocaleString()}</span>
            </div>
          `;
        });
        html += `</div>`;
      }
      
      html += `</div>`;
    });
    
    html += '</div>';
    this.containers.runRego.innerHTML = html;
  }

  renderRunSpon(payments) {
    if (payments.length === 0) {
      this.containers.runSpon.innerHTML = '<p class="no-data">No sponsorship payments for this date.</p>';
      return;
    }

    // Calculate grand total
    const grandTotal = payments.reduce((sum, p) => {
      let total = 0;
      if (p.self) total += p.self.amount || 0;
      if (p.others) total += p.others.reduce((s, o) => s + (o.amount || 0), 0);
      return sum + total;
    }, 0);

    let html = '<div class="payment-section">';
    html += `<div class="grand-total">Grand Total: ₦${grandTotal.toLocaleString()}</div>`;
    
    payments.forEach((payment, idx) => {
      const number = idx + 1;
      html += `<div class="payer-card">`;
      html += `<div class="payer-header"><span class="payment-number" style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #FF6D00; color: white; border-radius: 50%; font-weight: bold; font-size: 14px; margin-right: 10px;">${number}</span>Sponsorship <span class="payer-name">by ${payment.payer}</span></div>`;
      
      if (payment.self) {
        html += `
          <div class="payment-row self sponsor">
            <span class="label">Self Sponsorship:</span>
            <span class="hash-handle">${payment.payer}</span>
            <span class="amount">₦${payment.self.amount.toLocaleString()}</span>
          </div>
        `;
      }
      
      if (payment.others && payment.others.length > 0) {
        html += `<div class="others-section">`;
        html += `<div class="others-header">Sponsoring Others:</div>`;
        payment.others.forEach(other => {
          html += `
            <div class="payment-row other sponsor">
              <span class="hash-handle">${other.hashHandle}</span>
              <span class="amount">₦${other.amount.toLocaleString()}</span>
            </div>
          `;
        });
        html += `</div>`;
      }
      
      html += `</div>`;
    });
    
    html += '</div>';
    this.containers.runSpon.innerHTML = html;
  }

async loadEventData(date) {
    try {
      this.containers.eventRego.innerHTML = 'Loading...';
      this.containers.eventAcc.innerHTML = 'Loading...';
      this.containers.eventSpon.innerHTML = 'Loading...';

      const payQuery = query(
        collection(this.db, 'paymentRequests'),
        where('kennel', '==', this.userKennel),
        where('type', '==', 'event-payment')
      );

      const paySnaps = await getDocs(payQuery);
      
      const regoPayments = [];
      const accPayments = [];
      const sponPayments = [];

      for (const payDoc of paySnaps.docs) {
        const payData = payDoc.data();
        const eventId = payData.eventId;
        if (!eventId) continue;

        const eventDoc = await getDoc(doc(this.db, 'events', eventId));
        if (!eventDoc.exists()) continue;
        
        const eventData = eventDoc.data();
        const eventDate = eventData.startDate;
        
        if (eventDate !== date) continue;

        const uid = payData.userId;
        if (!uid) continue;

        const userDoc = await getDoc(doc(this.db, 'users', uid));
        const userData = userDoc.data() || {};
        const payerHandle = userData.hashHandle || 'Unknown';

        // REGO - Check for regoForHashers (legacy) OR regoSelf/regoOthers (new)
        const regoForHashers = payData.regoForHashers || [];
        const regoSelf = payData.regoSelf;
        const regoOthers = payData.regoOthers || [];
        
        const hasRego = regoForHashers.length > 0 || 
                       (regoSelf?.selected && regoSelf.amount > 0) || 
                       regoOthers.length > 0;
        
        if (hasRego) {
          let selfEntry = null;
          let othersList = [];
          
          // Legacy format: regoForHashers array
          if (regoForHashers.length > 0) {
            const amountPerPerson = (payData.regoAmount || 0) / regoForHashers.length;
            // Check if payer is in the list
            if (regoForHashers.includes(payerHandle)) {
              selfEntry = {
                hashHandle: payerHandle,
                amount: amountPerPerson,
                drinkBrand: '',
                drinkType: '',
                tshirtSize: ''
              };
            }
            // Others are everyone except payer
            othersList = regoForHashers
              .filter(h => h !== payerHandle)
              .map(h => ({
                hashHandle: h,
                amount: amountPerPerson,
                drinkBrand: '',
                drinkType: '',
                tshirtSize: ''
              }));
          } 
          // New format: regoSelf/regoOthers with full details
          else {
            if (regoSelf?.selected && regoSelf.amount > 0) {
              selfEntry = {
                hashHandle: payerHandle,
                amount: regoSelf.amount || 0,
                drinkBrand: regoSelf.drinkBrand || '',
                drinkType: regoSelf.drinkType || '',
                tshirtSize: regoSelf.tshirtSize || ''
              };
            }
            othersList = regoOthers.map(r => ({
              hashHandle: r.hashHandle,
              amount: r.amount || 0,
              drinkBrand: r.drinkBrand || '',
              drinkType: r.drinkType || '',
              tshirtSize: r.tshirtSize || ''
            }));
          }
          
          regoPayments.push({
            eventTitle: eventData.title || 'Unknown Event',
            payer: payerHandle,
            self: selfEntry,
            others: othersList,
            totalAmount: payData.regoAmount || 0,
            status: payData.regoStatus || 'Not Paid'
          });
        }

        // ACCOMMODATION - Check for selectedRooms (legacy) OR accommodationSelf/accommodationOthers (new)
        const selectedRooms = payData.selectedRooms || [];
        const accSelf = payData.accommodationSelf;
        const accOthers = payData.accommodationOthers || [];
        
        const hasAcc = selectedRooms.length > 0 ||
                      (accSelf?.selected && accSelf.bookings?.length > 0) ||
                      accOthers.length > 0;
        
        if (hasAcc) {
          let selfBookings = [];
          let othersList = [];
          let totalAccAmount = 0;
          
          // Legacy format: selectedRooms array
          if (selectedRooms.length > 0) {
            selfBookings = selectedRooms.map(r => ({
              roomType: r.roomType || 'Standard',
              nights: r.nights || 1,
              qty: r.qty || 1,
              amountPerNight: r.amountPerNight || 0,
              total: r.total || (r.amountPerNight * r.nights * r.qty)
            }));
            totalAccAmount = selfBookings.reduce((s, b) => s + b.total, 0);
          }
          // New format: accommodationSelf/accommodationOthers
          else {
            if (accSelf?.selected && accSelf.bookings) {
              selfBookings = accSelf.bookings.map(b => ({
                roomType: b.roomType,
                nights: b.nights,
                qty: b.qty,
                amountPerNight: b.amountPerNight,
                total: b.total
              }));
            }
            othersList = accOthers.map(o => ({
              hashHandle: o.hashHandle,
              bookings: (o.bookings || []).map(b => ({
                roomType: b.roomType,
                nights: b.nights,
                qty: b.qty,
                amountPerNight: b.amountPerNight,
                total: b.total
              })),
              totalAmount: o.amount
            }));
            totalAccAmount = payData.accommodationAmount || 
              (accSelf?.bookings || []).reduce((s, b) => s + (b.total || 0), 0) +
              accOthers.reduce((s, o) => s + (o.amount || 0), 0);
          }
          
          accPayments.push({
            eventTitle: eventData.title || 'Unknown Event',
            payer: payerHandle,
            self: selfBookings.length > 0 ? { bookings: selfBookings } : null,
            others: othersList,
            totalAmount: totalAccAmount,
            status: payData.accommodationStatus || 'Not Paid'
          });
        }

        // SPONSORSHIP - Check for sponsorshipFor (legacy) OR sponsorshipSelf/sponsorshipOthers (new)
        const sponsorshipFor = payData.sponsorshipFor || [];
        const sponSelf = payData.sponsorshipSelf;
        const sponOthers = payData.sponsorshipOthers || [];
        
        const hasSpon = sponsorshipFor.length > 0 ||
                       (sponSelf?.selected && sponSelf.amount > 0) ||
                       sponOthers.length > 0;
        
        if (hasSpon) {
          let selfAmount = 0;
          let othersList = [];
          let totalSponAmount = 0;
          
          // Legacy format: sponsorshipFor array
          if (sponsorshipFor.length > 0) {
            const amountPerPerson = (payData.sponsorshipAmount || 0) / sponsorshipFor.length;
            if (sponsorshipFor.includes(payerHandle)) {
              selfAmount = amountPerPerson;
            }
            othersList = sponsorshipFor
              .filter(h => h !== payerHandle)
              .map(h => ({ hashHandle: h, amount: amountPerPerson }));
            totalSponAmount = payData.sponsorshipAmount || 0;
          }
          // New format: sponsorshipSelf/sponsorshipOthers
          else {
            if (sponSelf?.selected) {
              selfAmount = sponSelf.amount || 0;
            }
            othersList = sponOthers.map(s => ({
              hashHandle: s.hashHandle,
              amount: s.amount
            }));
            totalSponAmount = payData.sponsorshipAmount || 
              (sponSelf?.amount || 0) +
              sponOthers.reduce((s, o) => s + (o.amount || 0), 0);
          }
          
          sponPayments.push({
            eventTitle: eventData.title || 'Unknown Event',
            payer: payerHandle,
            self: selfAmount > 0 ? { amount: selfAmount } : null,
            others: othersList,
            totalAmount: totalSponAmount,
            status: payData.sponsorshipStatus || 'Not Paid'
          });
        }
      }

      this.renderEventRego(regoPayments);
      this.renderEventAcc(accPayments);
      this.renderEventSpon(sponPayments);

    } catch (err) {
      console.error('loadEventData error:', err);
      this.containers.eventRego.innerHTML = `Error: ${err.message}`;
      this.containers.eventAcc.innerHTML = `Error: ${err.message}`;
      this.containers.eventSpon.innerHTML = `Error: ${err.message}`;
    }
  }


renderEventRego(payments) {
    if (payments.length === 0) {
      this.containers.eventRego.innerHTML = '<p class="no-data">No rego payments for this date.</p>';
      return;
    }

    const grandTotal = payments.reduce((sum, p) => sum + (p.totalAmount || 0), 0);

    // Calculate drink brand and t-shirt size totals
    const drinkBrandTotals = {};
    const tshirtSizeTotals = {};

    payments.forEach(payment => {
      // Count self
      if (payment.self && payment.self.amount > 0) {
        if (payment.self.drinkBrand) {
          drinkBrandTotals[payment.self.drinkBrand] = (drinkBrandTotals[payment.self.drinkBrand] || 0) + 1;
        }
        if (payment.self.tshirtSize) {
          tshirtSizeTotals[payment.self.tshirtSize] = (tshirtSizeTotals[payment.self.tshirtSize] || 0) + 1;
        }
      }
      // Count others
      if (payment.others && payment.others.length > 0) {
        payment.others.forEach(other => {
          if (other.drinkBrand) {
            drinkBrandTotals[other.drinkBrand] = (drinkBrandTotals[other.drinkBrand] || 0) + 1;
          }
          if (other.tshirtSize) {
            tshirtSizeTotals[other.tshirtSize] = (tshirtSizeTotals[other.tshirtSize] || 0) + 1;
          }
        });
      }
    });

    // Format totals for display
    const drinkBrandSummary = Object.entries(drinkBrandTotals)
      .map(([brand, count]) => `${brand}: ${count}`)
      .join(', ') || 'None';
    
    const tshirtSizeSummary = Object.entries(tshirtSizeTotals)
      .map(([size, count]) => `${size}: ${count}`)
      .join(', ') || 'None';

    let html = '<div class="payment-section">';
    html += `<div class="grand-total">Grand Total: ₦${grandTotal.toLocaleString()}</div>`;
    html += `<div class="inventory-totals" style="margin-top: 8px; padding: 12px; background: #f5f5f5; border-radius: 8px; font-size: 14px;">`;
    html += `<div style="margin-bottom: 8px;"><strong>🍺 Drinks:</strong> ${drinkBrandSummary}</div>`;
    html += `<div><strong>👕 T-Shirts:</strong> ${tshirtSizeSummary}</div>`;
    html += `</div>`;
    
    payments.forEach((payment, idx) => {
      const number = idx + 1;
      html += `<div class="payer-card">`;
      html += `<div class="event-title">${payment.eventTitle}</div>`;
      html += `<div class="payer-header"><span class="payment-number" style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #FF6D00; color: white; border-radius: 50%; font-weight: bold; font-size: 14px; margin-right: 10px;">${number}</span>Payment <span class="payer-name">by ${payment.payer}</span> <span class="status-badge ${(payment.status || '').toLowerCase().replace(' ', '-')}">${payment.status}</span></div>`;
      
      html += `<div class="payment-details">`;
      html += `<div class="amount-total">Total: ₦${(payment.totalAmount || 0).toLocaleString()}</div>`;
      
      if (payment.self && payment.self.amount > 0) {
        html += `<div class="rego-section self">`;
        html += `<div class="rego-header">Self:</div>`;
        html += `<div class="rego-row detailed">`;
        html += `<span class="hash-handle">${payment.self.hashHandle}</span>`;
        html += `<span class="amount">₦${(payment.self.amount || 0).toLocaleString()}</span>`;
        html += `</div>`;
        // Add drink and shirt details
        const details = [];
        if (payment.self.drinkBrand) details.push(payment.self.drinkBrand);
        if (payment.self.drinkType) details.push(payment.self.drinkType);
        if (payment.self.tshirtSize) details.push(`Shirt: ${payment.self.tshirtSize}`);
        if (details.length > 0) {
          html += `<div class="rego-details">${details.join(' • ')}</div>`;
        }
        html += `</div>`;
      }
      
      if (payment.others && payment.others.length > 0) {
        html += `<div class="rego-section others">`;
        html += `<div class="others-header">For Others:</div>`;
        payment.others.forEach(other => {
          html += `<div class="rego-row detailed">`;
          html += `<span class="hash-handle">${other.hashHandle}</span>`;
          html += `<span class="amount">₦${(other.amount || 0).toLocaleString()}</span>`;
          html += `</div>`;
          // Add drink and shirt details for each other hasher
          const details = [];
          if (other.drinkBrand) details.push(other.drinkBrand);
          if (other.drinkType) details.push(other.drinkType);
          if (other.tshirtSize) details.push(`Shirt: ${other.tshirtSize}`);
          if (details.length > 0) {
            html += `<div class="rego-details">${details.join(' • ')}</div>`;
          }
        });
        html += `</div>`;
      }
      
      html += `</div>`;
      html += `</div>`;
    });
    
    html += '</div>';
    this.containers.eventRego.innerHTML = html;
  }


  renderEventAcc(payments) {
    if (payments.length === 0) {
      this.containers.eventAcc.innerHTML = '<p class="no-data">No accommodation bookings for this date.</p>';
      return;
    }

    const grandTotal = payments.reduce((sum, p) => sum + (p.totalAmount || 0), 0);

    let html = '<div class="payment-section">';
    html += `<div class="grand-total">Grand Total: ₦${grandTotal.toLocaleString()}</div>`;
    
   payments.forEach((payment, idx) => {
      const number = idx + 1;
      html += `<div class="payer-card">`;
      html += `<div class="event-title">${payment.eventTitle}</div>`;
      html += `<div class="payer-header"><span class="payment-number" style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #FF6D00; color: white; border-radius: 50%; font-weight: bold; font-size: 14px; margin-right: 10px;">${number}</span>Booking <span class="payer-name">by ${payment.payer}</span> <span class="status-badge ${(payment.status || '').toLowerCase().replace(' ', '-')}">${payment.status}</span></div>`;
      
      html += `<div class="payment-details">`;
      html += `<div class="amount-total">Total: ₦${(payment.totalAmount || 0).toLocaleString()}</div>`;
      
      if (payment.self && payment.self.bookings && payment.self.bookings.length > 0) {
        html += `<div class="acc-section self">`;
        html += `<div class="acc-header">Self:</div>`;
        payment.self.bookings.forEach(booking => {
          html += `
            <div class="booking-detail">
              <span class="room-type">${booking.roomType || 'Standard'}</span>
              <span class="booking-info">${booking.qty || 1} room(s) × ${booking.nights || 1} night(s)</span>
              <span class="rate">₦${(booking.amountPerNight || 0).toLocaleString()}/night</span>
              <span class="booking-total">₦${(booking.total || 0).toLocaleString()}</span>
            </div>
          `;
        });
        html += `</div>`;
      }
      
      if (payment.others && payment.others.length > 0) {
        html += `<div class="acc-section others">`;
        payment.others.forEach(other => {
          const otherTotal = other.totalAmount || (other.bookings || []).reduce((s, b) => s + (b.total || 0), 0);
          html += `<div class="other-header">For: ${other.hashHandle} (₦${otherTotal.toLocaleString()})</div>`;
          if (other.bookings && other.bookings.length > 0) {
            other.bookings.forEach(booking => {
              html += `
                <div class="booking-detail">
                  <span class="room-type">${booking.roomType || 'Standard'}</span>
                  <span class="booking-info">${booking.qty || 1} room(s) × ${booking.nights || 1} night(s)</span>
                  <span class="rate">₦${(booking.amountPerNight || 0).toLocaleString()}/night</span>
                  <span class="booking-total">₦${(booking.total || 0).toLocaleString()}</span>
                </div>
              `;
            });
          }
        });
        html += `</div>`;
      }
      
      html += `</div>`;
      html += `</div>`;
    });
    
    html += '</div>';
    this.containers.eventAcc.innerHTML = html;
  }

  renderEventSpon(payments) {
    if (payments.length === 0) {
      this.containers.eventSpon.innerHTML = '<p class="no-data">No sponsorships for this date.</p>';
      return;
    }

    const grandTotal = payments.reduce((sum, p) => sum + (p.totalAmount || 0), 0);

    let html = '<div class="payment-section">';
    html += `<div class="grand-total">Grand Total: ₦${grandTotal.toLocaleString()}</div>`;
    
    payments.forEach((payment, idx) => {
      const number = idx + 1;
      html += `<div class="payer-card">`;
      html += `<div class="event-title">${payment.eventTitle}</div>`;
      html += `<div class="payer-header"><span class="payment-number" style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #FF6D00; color: white; border-radius: 50%; font-weight: bold; font-size: 14px; margin-right: 10px;">${number}</span>Sponsorship <span class="payer-name">by ${payment.payer}</span> <span class="status-badge ${(payment.status || '').toLowerCase().replace(' ', '-')}">${payment.status}</span></div>`;
      
      html += `<div class="payment-details">`;
      html += `<div class="amount-total">Total: ₦${(payment.totalAmount || 0).toLocaleString()}</div>`;
      
      if (payment.self && payment.self.amount > 0) {
        html += `<div class="spon-section self">`;
        html += `<div class="spon-row">`;
        html += `<span class="label">Self:</span>`;
        html += `<span class="hash-handle">${payment.payer}</span>`;
        html += `<span class="amount">₦${(payment.self.amount || 0).toLocaleString()}</span>`;
        html += `</div>`;
        html += `</div>`;
      }
      
      if (payment.others && payment.others.length > 0) {
        html += `<div class="spon-section others">`;
        html += `<div class="others-header">Sponsoring Others:</div>`;
        payment.others.forEach(other => {
          html += `<div class="spon-row">`;
          html += `<span class="hash-handle">${other.hashHandle}</span>`;
          html += `<span class="amount">₦${(other.amount || 0).toLocaleString()}</span>`;
          html += `</div>`;
        });
        html += `</div>`;
      }
      
      html += `</div>`;
      html += `</div>`;
    });
    
    html += '</div>';
    this.containers.eventSpon.innerHTML = html;
  }
  
}


document.addEventListener('DOMContentLoaded', () => {
  new HomeManager();
});

