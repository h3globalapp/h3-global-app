import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, deleteUser, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc, 
    deleteDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    FieldValue 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyBhhU-vo9qmMKETOdjgz24JrsRv-rojUBc",
    authDomain: "h3-global-app.firebaseapp.com",
    projectId: "h3-global-app",
    storageBucket: "h3-global-app.firebasestorage.app",
    messagingSenderId: "174897234240",
    appId: "1:174897234240:web:74612994c432f410843aa5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

class PersonalManager {
    constructor() {
        this.currentUser = null;
        this.userData = null;
        this.cropper = null;
        this.allDesignations = [];
        
        // Initialize empty els object first
        this.els = {};
        
        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        this.checkAuthState();
    }

    cacheElements() {
        // Profile elements
        this.els.profileImage = document.getElementById('profileImage');
        this.els.btnEditPhoto = document.getElementById('btnEditPhoto');
        this.els.displayName = document.getElementById('displayName');
        this.els.displayKennel = document.getElementById('displayKennel');
        
        // Hash handle elements
        this.els.hashHandle = document.getElementById('hashHandle');
        this.els.hashInput = document.getElementById('hashInput');
        this.els.btnEditHash = document.getElementById('btnEditHash');
        this.els.btnSaveHash = document.getElementById('btnSaveHash');
        
        // Kennel elements
        this.els.kennel = document.getElementById('kennel');
        
        // Designation elements
        this.els.designation = document.getElementById('designation');
        this.els.designationSelect = document.getElementById('designationSelect');
        this.els.btnEditDesig = document.getElementById('btnEditDesig');
        this.els.btnSaveDesig = document.getElementById('btnSaveDesig');
        
        // Stats elements
        this.els.totalRuns = document.getElementById('totalRuns');
        this.els.statsContainer = document.getElementById('statsContainer');
        
        // Delete account
        this.els.btnDeleteAccount = document.getElementById('btnDeleteAccount');
        
        // File input
        this.els.fileInput = document.getElementById('fileInput');
        
        // Loading overlay
        this.els.loadingOverlay = document.getElementById('loadingOverlay');
        this.els.loadingText = document.getElementById('loadingText');
        
        // Confirmation dialog
        this.els.confirmDialog = document.getElementById('confirmDialog');
        this.els.btnCancelDelete = document.getElementById('btnCancelDelete');
        this.els.btnConfirmDelete = document.getElementById('btnConfirmDelete');
        
        // Toast
        this.els.toast = document.getElementById('toast');
        
        // Bottom nav
        this.els.bottomNav = document.querySelector('.bottom-nav');
        
        // Cropper modal elements - check if they exist first
        this.els.cropperModal = document.getElementById('cropperModal');
        this.els.cropperImage = document.getElementById('cropperImage');
        this.els.zoomSlider = document.getElementById('zoomSlider');
        this.els.btnCloseCropper = document.getElementById('btnCloseCropper');
        this.els.btnCancelCrop = document.getElementById('btnCancelCrop');
        this.els.btnConfirmCrop = document.getElementById('btnConfirmCrop');
    }

    setupEventListeners() {
        // Bottom nav - EXACTLY like home page
        document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
            item.onclick = (e) => {
                e.preventDefault();
                const screen = item.dataset.screen;
                this.handleBottomNav(screen);
            };
        });

        // Profile photo edit
        if (this.els.btnEditPhoto) {
            this.els.btnEditPhoto.addEventListener('click', () => this.els.fileInput.click());
        }
        
        if (this.els.fileInput) {
            this.els.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // Hash handle edit
        if (this.els.btnEditHash) {
            this.els.btnEditHash.addEventListener('click', () => this.toggleEdit('hash'));
        }
        
        if (this.els.btnSaveHash) {
            this.els.btnSaveHash.addEventListener('click', () => this.saveHashHandle());
        }

        // Designation edit
        if (this.els.btnEditDesig) {
            this.els.btnEditDesig.addEventListener('click', () => this.toggleEdit('designation'));
        }
        
        if (this.els.btnSaveDesig) {
            this.els.btnSaveDesig.addEventListener('click', () => this.saveDesignation());
        }

        // Zoom slider
        if (this.els.zoomSlider) {
            this.els.zoomSlider.addEventListener('input', (e) => {
                if (this.cropper) {
                    const ratio = parseFloat(e.target.value);
                    this.cropper.zoomTo(ratio);
                }
            });
        }

        // Cropper buttons
        if (this.els.btnCloseCropper) {
            this.els.btnCloseCropper.addEventListener('click', () => this.closeCropper());
        }
        
        if (this.els.btnCancelCrop) {
            this.els.btnCancelCrop.addEventListener('click', () => this.closeCropper());
        }
        
        if (this.els.btnConfirmCrop) {
            this.els.btnConfirmCrop.addEventListener('click', () => this.confirmCrop());
        }

        // Delete account
        if (this.els.btnDeleteAccount) {
            this.els.btnDeleteAccount.addEventListener('click', () => this.showDeleteConfirm());
        }
        
        if (this.els.btnCancelDelete) {
            this.els.btnCancelDelete.addEventListener('click', () => this.hideDeleteConfirm());
        }
        
        if (this.els.btnConfirmDelete) {
            this.els.btnConfirmDelete.addEventListener('click', () => this.deleteAccount());
        }
    }

    // EXACTLY like home page
    handleBottomNav(screen) {
        switch(screen) {
            case 'home':
                window.location.href = 'index.html';
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

    // EXACTLY like home page
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

    // EXACTLY like home page
    handleMoreOption(index) {
        switch(index) {
            case 0:
                this.logout();
                break;
            case 1:
                window.location.href = 'business-hub.html';
                break;
            case 2:
                // Already on personal
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

    // EXACTLY like home page
    toggleDayNight() {
        const isNight = localStorage.getItem('night_mode') === 'true';
        localStorage.setItem('night_mode', !isNight);
        document.body.classList.toggle('night-mode', !isNight);
    }

    // EXACTLY like home page
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

    // EXACTLY like home page
    async logout() {
        try {
            await signOut(auth);
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    checkAuthState() {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                this.currentUser = user;
                this.loadUserData();
            } else {
                window.location.href = 'login.html';
            }
        });
    }

    async loadUserData() {
        try {
            const userDoc = await getDoc(doc(db, 'users', this.currentUser.uid));
            if (!userDoc.exists()) {
                this.showToast('User data not found');
                return;
            }

            this.userData = userDoc.data();
            
            // Update UI
            if (this.els.displayName) this.els.displayName.textContent = this.userData.hashHandle || 'Hasher';
            if (this.els.displayKennel) this.els.displayKennel.textContent = this.userData.kennel || 'Unknown Kennel';
            if (this.els.hashHandle) this.els.hashHandle.textContent = this.userData.hashHandle || '-';
            if (this.els.kennel) this.els.kennel.textContent = this.userData.kennel || '-';
            if (this.els.designation) this.els.designation.textContent = this.userData.designation || '-';
            
            // Load profile image
            if (this.userData.profilePicUrl && this.els.profileImage) {
                this.els.profileImage.src = this.userData.profilePicUrl;
            }
            
            // Load stats
            this.loadStats();
            
            // Load designation options
            this.loadDesignations();
            
        } catch (error) {
            console.error('Error loading user data:', error);
            this.showToast('Failed to load profile');
        }
    }

    loadStats() {
        if (!this.els.totalRuns || !this.els.statsContainer) return;
        
        const total = this.userData.totalRuns || 0;
        this.els.totalRuns.textContent = total;
        
        const kennelStats = this.userData.kennelStats || {};
        
        // Clear existing kennel stats (keep total)
        const existingKennelStats = this.els.statsContainer.querySelectorAll('.kennel-stat');
        existingKennelStats.forEach(el => el.remove());
        
        // Add kennel stats
        Object.entries(kennelStats).forEach(([kennelId, count]) => {
            const statItem = document.createElement('div');
            statItem.className = 'stat-item kennel-stat';
            statItem.innerHTML = `
                <span class="stat-label">${kennelId}</span>
                <span class="stat-value">${count}</span>
            `;
            this.els.statsContainer.appendChild(statItem);
        });
    }

    async loadDesignations() {
        if (!this.els.designationSelect) return;
        
        const userKennel = this.userData.kennel;
        if (!userKennel) return;

        const tier2Designations = ['Grand Master', 'Hash Master', 'Religious Adviser', 'On Sec'];
        const otherDesignations = ['DGM', 'DHM', 'Hasher'];

        this.allDesignations = [];

        try {
            // Check Admin
            const adminDoc = await getDoc(doc(db, 'designations', 'Admin'));
            const tier1Exists = adminDoc.exists();

            // Check kennel designations
            const kennelDoc = await getDoc(doc(db, 'designations', userKennel));
            const taken = kennelDoc.exists() ? Object.keys(kennelDoc.data()) : [];

            const gmTaken = taken.includes('Grand Master');
            const hmTaken = taken.includes('Hash Master');
            const raTaken = taken.includes('Religious Adviser');
            const onSecTaken = taken.includes('On Sec');

            // Build available list
            if (!tier1Exists) this.allDesignations.push('Admin');
            
            // GM and HM are mutually exclusive
            if (!gmTaken && !hmTaken) {
                this.allDesignations.push('Grand Master');
                this.allDesignations.push('Hash Master');
            }
            
            if (!raTaken) this.allDesignations.push('Religious Adviser');
            if (!onSecTaken) this.allDesignations.push('On Sec');
            
            this.allDesignations.push(...otherDesignations);

            // Populate select
            this.els.designationSelect.innerHTML = '<option value="">Select designation</option>';
            this.allDesignations.forEach(desig => {
                const option = document.createElement('option');
                option.value = desig;
                option.textContent = desig;
                this.els.designationSelect.appendChild(option);
            });

            // Set current selection
            const currentDesig = this.userData.designation;
            if (currentDesig && this.allDesignations.includes(currentDesig)) {
                this.els.designationSelect.value = currentDesig;
            }

        } catch (error) {
            console.error('Error loading designations:', error);
        }
    }

    toggleEdit(field) {
        if (field === 'hash') {
            const isEditing = this.els.hashInput.style.display === 'block';
            if (isEditing) {
                // Cancel edit
                this.els.hashInput.style.display = 'none';
                this.els.hashHandle.style.display = 'block';
                this.els.btnEditHash.style.display = 'flex';
                this.els.btnSaveHash.style.display = 'none';
            } else {
                // Start edit
                this.els.hashInput.value = this.userData.hashHandle || '';
                this.els.hashInput.style.display = 'block';
                this.els.hashHandle.style.display = 'none';
                this.els.btnEditHash.style.display = 'none';
                this.els.btnSaveHash.style.display = 'block';
                this.els.hashInput.focus();
            }
        } else if (field === 'designation') {
            const isEditing = this.els.designationSelect.style.display === 'block';
            if (isEditing) {
                // Cancel edit
                this.els.designationSelect.style.display = 'none';
                this.els.designation.style.display = 'block';
                this.els.btnEditDesig.style.display = 'flex';
                this.els.btnSaveDesig.style.display = 'none';
            } else {
                // Start edit
                this.els.designationSelect.style.display = 'block';
                this.els.designation.style.display = 'none';
                this.els.btnEditDesig.style.display = 'none';
                this.els.btnSaveDesig.style.display = 'block';
            }
        }
    }

    async saveHashHandle() {
        const newHash = this.els.hashInput.value.trim();
        if (!newHash) {
            this.showToast('Hash handle cannot be empty');
            return;
        }

        this.els.btnSaveHash.disabled = true;
        this.els.btnSaveHash.textContent = 'Saving...';

        try {
            await updateDoc(doc(db, 'users', this.currentUser.uid), {
                hashHandle: newHash
            });
            
            this.userData.hashHandle = newHash;
            this.els.hashHandle.textContent = newHash;
            this.els.displayName.textContent = newHash;
            
            this.toggleEdit('hash');
            this.showToast('Hash handle updated');
            
        } catch (error) {
            console.error('Error saving hash handle:', error);
            this.showToast('Failed to update hash handle');
        } finally {
            this.els.btnSaveHash.disabled = false;
            this.els.btnSaveHash.textContent = 'Save';
        }
    }

    async saveDesignation() {
        const newDesig = this.els.designationSelect.value;
        if (!newDesig) {
            this.showToast('Please select a designation');
            return;
        }

        if (!this.allDesignations.includes(newDesig)) {
            this.showToast('Invalid designation selected');
            return;
        }

        const oldDesig = this.userData.designation;
        const kennel = this.userData.kennel;

        if (oldDesig === newDesig) {
            this.toggleEdit('designation');
            return;
        }

        this.els.btnSaveDesig.disabled = true;
        this.els.btnSaveDesig.textContent = 'Saving...';

        try {
            // 1. Update user doc
            await updateDoc(doc(db, 'users', this.currentUser.uid), {
                designation: newDesig
            });

            // 2. Remove old designation from kennel
            if (oldDesig && kennel) {
                const kennelRef = doc(db, 'designations', kennel);
                const updates = {};
                updates[oldDesig] = FieldValue.delete();
                await updateDoc(kennelRef, updates).catch(() => {
                    // Ignore if document doesn't exist
                });
            }

            // 3. Add new designation to kennel (with user reference)
            if (kennel) {
                const kennelRef = doc(db, 'designations', kennel);
                await updateDoc(kennelRef, {
                    [newDesig]: this.userData.phone || this.currentUser.uid
                }, { merge: true });
            }

            this.userData.designation = newDesig;
            this.els.designation.textContent = newDesig;
            
            this.toggleEdit('designation');
            this.showToast('Designation updated');
            
            // Reload designations to update available options
            this.loadDesignations();

        } catch (error) {
            console.error('Error saving designation:', error);
            this.showToast('Failed to update designation');
        } finally {
            this.els.btnSaveDesig.disabled = false;
            this.els.btnSaveDesig.textContent = 'Save';
        }
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            this.showToast('Please select an image file');
            return;
        }

        // Read file and show cropper
        const reader = new FileReader();
        reader.onload = (e) => {
            this.openCropper(e.target.result);
        };
        reader.readAsDataURL(file);
    }

    openCropper(imageSrc) {
        // Create modal if it doesn't exist
        if (!this.els.cropperModal) {
            this.createCropperModal();
        }
        
        this.els.cropperImage.src = imageSrc;
        this.els.cropperModal.classList.add('active');
        
        // Initialize cropper after image loads
        this.els.cropperImage.onload = () => {
            this.initCropper();
        };
    }

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
                // Set initial zoom
                this.els.zoomSlider.value = 1;
            },
            zoom: (event) => {
                // Update slider when zooming with mouse/touch
                const ratio = event.detail.ratio;
                this.els.zoomSlider.value = ratio;
            }
        });
    }

    closeCropper() {
        if (this.els.cropperModal) {
            this.els.cropperModal.classList.remove('active');
        }
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }
        if (this.els.fileInput) {
            this.els.fileInput.value = ''; // Reset file input
        }
    }

    async confirmCrop() {
        if (!this.cropper) return;

        this.showLoading('Processing image...');

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

            this.showLoading('Uploading...');

            // Upload to Firebase Storage
            const storageRef = ref(storage, `profilePics/${this.currentUser.uid}.jpg`);
            await uploadBytes(storageRef, blob);
            
            // Get download URL
            const downloadURL = await getDownloadURL(storageRef);
            
            // Update user doc
            await updateDoc(doc(db, 'users', this.currentUser.uid), {
                profilePicUrl: downloadURL
            });

            // Update UI
            this.els.profileImage.src = downloadURL;
            this.userData.profilePicUrl = downloadURL;
            
            this.closeCropper();
            this.hideLoading();
            this.showToast('Profile picture updated');
            
        } catch (error) {
            console.error('Error uploading image:', error);
            this.hideLoading();
            this.showToast('Failed to upload image');
        }
    }

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

    showDeleteConfirm() {
        if (this.els.confirmDialog) {
            this.els.confirmDialog.classList.add('active');
        }
    }

    hideDeleteConfirm() {
        if (this.els.confirmDialog) {
            this.els.confirmDialog.classList.remove('active');
        }
    }

    async deleteAccount() {
        this.hideDeleteConfirm();
        this.showLoading('Deleting account...');

        try {
            const uid = this.currentUser.uid;
            const phone = this.userData.phone || '';
            const kennel = this.userData.kennel || '';
            const designation = this.userData.designation || '';

            // 1. Delete phoneNumbers entry
            if (phone) {
                try {
                    await deleteDoc(doc(db, 'phoneNumbers', phone));
                } catch (e) {
                    console.log('Phone number entry not found or already deleted');
                }
            }

            // 2. Remove designation mapping
            if (designation && kennel) {
                try {
                    const desigPath = designation === 'Admin' ? 'Admin' : kennel;
                    const kennelRef = doc(db, 'designations', desigPath);
                    const updates = {};
                    updates[designation] = FieldValue.delete();
                    await updateDoc(kennelRef, updates);
                } catch (e) {
                    console.log('Designation mapping not found');
                }
            }

            // 3. Delete profile picture
            try {
                const picRef = ref(storage, `profilePics/${uid}.jpg`);
                await deleteObject(picRef);
            } catch (e) {
                console.log('Profile picture not found or already deleted');
            }

            // 4. Delete user doc
            await deleteDoc(doc(db, 'users', uid));

            // 5. Delete Firebase Auth user
            await deleteUser(this.currentUser);

            this.hideLoading();
            this.showToast('Account deleted successfully');
            
            // Redirect to login
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 1500);

        } catch (error) {
            console.error('Error deleting account:', error);
            this.hideLoading();
            this.showToast('Failed to delete account: ' + error.message);
            
            // If error is "requires-recent-login", we need to reauthenticate
            if (error.code === 'auth/requires-recent-login') {
                this.showToast('Please log in again to delete your account');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 2000);
            }
        }
    }

    showLoading(text = 'Loading...') {
        if (this.els.loadingText) this.els.loadingText.textContent = text;
        if (this.els.loadingOverlay) this.els.loadingOverlay.classList.add('active');
    }

    hideLoading() {
        if (this.els.loadingOverlay) this.els.loadingOverlay.classList.remove('active');
    }

    showToast(message) {
        if (this.els.toast) {
            this.els.toast.textContent = message;
            this.els.toast.classList.add('show');
            
            setTimeout(() => {
                this.els.toast.classList.remove('show');
            }, 3000);
        } else {
            alert(message);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PersonalManager();
});