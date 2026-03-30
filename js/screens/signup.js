// Pre-check: Ensure Firebase is loaded before DOMContentLoaded
console.log('signup.js loading...');
console.log('Initial window.db:', !!window.db);
console.log('Initial window.functions:', !!window.functions);

// Helper to check Firebase readiness
window.checkFirebaseReady = function() {
  const ready = !!(window.db && window.functions);
  console.log('Firebase ready check:', { db: !!window.db, functions: !!window.functions, ready });
  return ready;
};

document.addEventListener('DOMContentLoaded', () => {
  // Wait for Firebase to be ready
  if (!window.db) {
    console.error('Firebase not initialized!');
    return;
  }

  // Import Firestore functions
  import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
    .then(({ collection, doc, getDocs, getDoc, addDoc, setDoc, Timestamp }) => {
      
      // DOM elements
      const els = {
        form: document.getElementById('signupForm'),
        country: document.getElementById('actvCountry'),
        state: document.getElementById('actvState'),
        kennel: document.getElementById('actvKennel'),
        designation: document.getElementById('actvDesignation'),
        modal: document.getElementById('addKennelModal'),
        btnSignup: document.getElementById('btnSignup')
      };

      // Helper: Get collection reference
      const getCol = (path) => collection(window.db, path);
      const getDocRef = (path) => doc(window.db, path);

      // Load countries from Firestore
      async function loadCountries() {
        try {
          console.log('Loading countries...');
          const snap = await getDocs(getCol('locations'));
          const countries = snap.docs.map(d => d.id).sort();
          console.log('Countries loaded:', countries);
          
          countries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            els.country.appendChild(opt);
          });
        } catch (err) {
          console.error('Error loading countries:', err);
          alert('Failed to load countries. Check console.');
        }
      }

      // Country selected → load states
      els.country.addEventListener('change', async () => {
        els.state.innerHTML = '<option value="" disabled selected>Select State</option>';
        els.state.disabled = false;
        els.kennel.innerHTML = '<option value="" disabled selected>Select Kennel</option>';
        els.kennel.disabled = true;
        els.designation.innerHTML = '<option value="" disabled selected>Select Designation</option>';
        els.designation.disabled = true;
        
        try {
          console.log('Loading states for:', els.country.value);
          const snap = await getDocs(getCol(`locations/${els.country.value}/states`));
          const states = snap.docs.map(d => d.id).sort();
          console.log('States loaded:', states);
          
          states.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            els.state.appendChild(opt);
          });
        } catch (err) {
          console.error('Error loading states:', err);
        }
      });

      // State selected → load kennels
      els.state.addEventListener('change', async () => {
        els.kennel.innerHTML = '<option value="" disabled selected>Select Kennel</option>';
        els.kennel.disabled = false;
        els.designation.innerHTML = '<option value="" disabled selected>Select Designation</option>';
        els.designation.disabled = true;
        
        try {
          console.log('Loading kennels for:', els.country.value, els.state.value);
          const snap = await getDocs(getCol(`locations/${els.country.value}/states/${els.state.value}/kennels`));
          const kennels = snap.docs.map(d => d.id).sort();
          kennels.push('(+ Add Kennel)');
          console.log('Kennels loaded:', kennels);
          
          kennels.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = k;
            els.kennel.appendChild(opt);
          });
        } catch (err) {
          console.error('Error loading kennels:', err);
        }
      });

      // Kennel selected
      els.kennel.addEventListener('change', async () => {
        if (els.kennel.value === '(+ Add Kennel)') {
          els.modal.classList.remove('hidden');
          els.kennel.value = '';
          return;
        }
        
        await loadDesignations();
      });

      // Load designations from Firestore
      async function loadDesignations() {
        els.designation.innerHTML = '<option value="" disabled selected>Select Designation</option>';
        els.designation.disabled = false;
        
        try {
          console.log('Loading designations for:', els.kennel.value);
          
          // Get role definitions
          const roleDoc = await getDoc(getDocRef('role/roleid'));
          const noTier = roleDoc.data()?.['No Tier'] || [];
          const tier1 = roleDoc.data()?.['Tier 1'] || [];
          const tier2 = roleDoc.data()?.['Tier 2'] || [];
          
          // Get taken designations
          const kennelDoc = await getDoc(getDocRef(`designations/${els.kennel.value}`));
          const taken = kennelDoc.exists() ? Object.keys(kennelDoc.data()) : [];
          
          // Check if Admin exists
          const adminDoc = await getDoc(getDocRef('designations/Admin'));
          const tier1Exists = adminDoc.exists();
          
          // Build available list
          let allDesignations = [];
          const gmHmBlock = ['Grand Master', 'Hash Master'];
          const gmOrHmTaken = gmHmBlock.some(d => taken.includes(d));
          
          const availableTier1 = tier1.filter(d => !taken.includes(d));
          const availableTier2 = tier2.filter(d => {
            if (gmHmBlock.includes(d)) return !gmOrHmTaken;
            return !taken.includes(d);
          });
          
          if (!tier1Exists) allDesignations.push(...availableTier1);
          allDesignations.push(...availableTier2);
          allDesignations.push(...noTier);
          
          console.log('Designations loaded:', allDesignations);
          
          allDesignations.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            els.designation.appendChild(opt);
          });
        } catch (err) {
          console.error('Error loading designations:', err);
          // Fallback
          const defaults = ['Grand Master', 'Hash Master', 'Religious Adviser', 'On Sec', 'Hasher'];
          defaults.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            els.designation.appendChild(opt);
          });
        }
      }

      // Modal buttons
      document.getElementById('btnCancelKennel').onclick = () => {
        els.modal.classList.add('hidden');
        document.getElementById('etPrefix').value = '';
      };

      document.getElementById('btnSubmitKennel').onclick = async () => {
        const prefix = document.getElementById('etPrefix').value.trim();
        if (!prefix) {
          alert('Please enter a kennel name prefix');
          return;
        }
        
        const suffix = document.querySelector('input[name="suffix"]:checked').value;
        const rawName = `${prefix} ${suffix}`;
        
        // Canonical name (matches Android logic)
        const canonical = canonicalKennelName(rawName);
        
        // Add to dropdown
        const opt = document.createElement('option');
        opt.value = canonical;
        opt.textContent = canonical;
        els.kennel.insertBefore(opt, els.kennel.lastChild);
        
        els.kennel.value = canonical;
        els.modal.classList.add('hidden');
        document.getElementById('etPrefix').value = '';
        
        // Create kennel request and temp kennel (matches Android logic)
        try {
          const { addDoc, collection } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
          
          // Get phone number from form
          const phone = document.getElementById('countryCodePicker').value + document.getElementById('etPhone').value.replace(/\D/g, '');
          
          // 1. Create kennelRequests document (matches Android queueOrCreateKennel)
          const request = {
            requesterUid: '',  // Will be empty during signup, filled later after OTP
            requesterPhone: phone,  // Allows lookup before auth
            country: els.country.value,
            state: els.state.value,
            requestedName: rawName,
            canonicalName: canonical,
            status: 'pending',
            timestamp: Timestamp.now()
          };
          
          const requestRef = await addDoc(collection(window.db, 'kennelRequests'), request);
          console.log('Kennel request created:', requestRef.id, request);
          
          // 2. Create TEMP kennel doc (matches Android tempKennelName logic)
          // Generate temp ID like Android: "PENDING-" + hashCode base36
          const tempId = tempKennelName(canonical);
          const tempRef = doc(window.db, `locations/${els.country.value}/states/${els.state.value}/kennels/${tempId}`);
          await setDoc(tempRef, {
            createdAt: Timestamp.now(),
            status: 'pending',
            requestedName: rawName,
            requesterPhone: phone,  // Also store here for reference
            originalRequestId: requestRef.id
          });
          console.log('Temp kennel created:', tempId);
          
          // Store temp kennel name for later use
          els.kennel.dataset.tempId = tempId;
          
        } catch (err) {
          console.error('Error creating kennel request:', err);
        }
        
        await loadDesignations();
      };

      // Canonical name helper (matches Android)
      function canonicalKennelName(raw) {
        let s = raw.trim().toLowerCase();
        s = s.replace(/\bh3\b/g, 'hash');
        s = s.replace(/\bhash3\b/g, 'hash');
        s = s.replace(/\bhhh\b/g, 'hash');
        s = s.replace(/\bhash\s+house\s+harriers\b/g, '');
        s = s.replace(/\s+/g, ' ').trim();
        const prefix = s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return `${prefix} Hash House Harriers`;
      }

      // Temp kennel name generator (matches Android exactly)
      function tempKennelName(requested) {
        // Java's hashCode algorithm ported to JavaScript
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

      // Form submit - ALL users use Termii
      els.form.onsubmit = async (e) => {
        e.preventDefault();
        console.log('1. Form submitted - starting signup flow');
        
        // Check if Firebase Functions is available
        if (!window.functions) {
          console.error('Firebase Functions not available on window object!');
          alert('System error: Firebase not properly loaded. Please refresh the page.');
          return;
        }
        console.log('1a. Firebase Functions available:', !!window.functions);
        
        els.btnSignup.disabled = true;
        els.btnSignup.textContent = 'Sending OTP...';
        
        // Collect all data
        const signupData = {
          hashHandle: document.getElementById('etHashHandle').value.trim(),
          firstName: document.getElementById('etFirstName').value.trim(),
          lastName: document.getElementById('etLastName').value.trim(),
          phone: document.getElementById('countryCodePicker').value + document.getElementById('etPhone').value.replace(/\D/g, ''),
          country: els.country.value,
          state: els.state.value,
          kennel: els.kennel.value,
          designation: els.designation.value
        };
        
        console.log('2. Phone number collected:', signupData.phone);
        console.log('2a. Full signup data:', signupData);
        
        // Validate
        if (!signupData.hashHandle || !signupData.firstName || !signupData.lastName || 
            !signupData.phone || !signupData.country || !signupData.state || 
            !signupData.kennel || !signupData.designation) {
          alert('Please fill all fields');
          els.btnSignup.disabled = false;
          els.btnSignup.textContent = 'CREATE ACCOUNT';
          return;
        }
        
        console.log('3. All fields valid, checking if phone exists...');
        
        // Check if phone number already exists
        try {
          const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
          const phoneRef = doc(window.db, 'phoneNumbers', signupData.phone);
          const phoneDoc = await getDoc(phoneRef);
          
          if (phoneDoc.exists()) {
            console.log('3a. Phone already exists, showing dialog');
            // Show custom dialog with Login Instead button
            const existingUserDialog = document.createElement('div');
            existingUserDialog.style.cssText = `
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0,0,0,0.6);
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 10000;
              font-family: sans-serif;
            `;
            
            existingUserDialog.innerHTML = `
              <div style="
                background: white;
                width: 90%;
                max-width: 400px;
                border-radius: 16px;
                padding: 24px;
                text-align: center;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
              ">
                <div style="font-size: 48px; margin-bottom: 16px;">📱</div>
                <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #333;">Already Registered</h2>
                <p style="margin: 0 0 24px 0; color: #666; line-height: 1.5;">
                  This phone number is already registered. Would you like to login instead?
                </p>
                <div style="display: flex; gap: 12px;">
                  <button id="btnStaySignup" style="
                    flex: 1;
                    padding: 12px;
                    border: 1px solid #ddd;
                    background: white;
                    color: #666;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                  ">Stay Here</button>
                  <button id="btnGoLogin" style="
                    flex: 1;
                    padding: 12px;
                    border: none;
                    background: #FF6D00;
                    color: white;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                  ">Login Instead</button>
                </div>
              </div>
            `;
            
            document.body.appendChild(existingUserDialog);
            
            // Button handlers
            existingUserDialog.querySelector('#btnStaySignup').onclick = () => {
              existingUserDialog.remove();
              els.btnSignup.disabled = false;
              els.btnSignup.textContent = 'CREATE ACCOUNT';
              document.getElementById('etPhone').value = '';
              document.getElementById('etPhone').focus();
            };
            
            existingUserDialog.querySelector('#btnGoLogin').onclick = () => {
              sessionStorage.setItem('pendingLoginPhone', signupData.phone);
              window.location.href = 'login.html';
            };
            
            existingUserDialog.onclick = (e) => {
              if (e.target === existingUserDialog) {
                existingUserDialog.remove();
                els.btnSignup.disabled = false;
                els.btnSignup.textContent = 'CREATE ACCOUNT';
              }
            };
            
            return;
          }
          console.log('3b. Phone number is new, proceeding to OTP');
        } catch (err) {
          console.error('Error checking phone (continuing anyway):', err);
        }
        
        try {
          console.log('4. Importing Firebase Functions...');
          // Use the global functions object instead of dynamic import
          const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
          console.log('4a. httpsCallable imported:', !!httpsCallable);
          console.log('4b. window.functions:', !!window.functions);
          
          console.log('5. Sending OTP via Termii...');
          const sendOtpTermii = httpsCallable(window.functions, 'sendOtpTermii');
          const result = await sendOtpTermii({
            phone: signupData.phone,
            firstName: signupData.firstName,
            lastName: signupData.lastName
          });
          
          console.log('6. OTP send result:', result.data);
          
          const { pin_id } = result.data;
          if (!pin_id) {
            throw new Error('Failed to get PIN ID from Termii');
          }
          console.log('6a. PIN ID received:', pin_id);
          
          // Prepare data for verification page
          const verifyData = {
            ...signupData,
            pinId: pin_id,
            isFirebase: false,
            isSignup: true
          };
          
          console.log('7. Saving data to storage:', verifyData);
          
          // Save to both storages with error handling
          let storageSuccess = false;
          try {
            localStorage.setItem('signupData', JSON.stringify(verifyData));
            console.log('7a. Saved to localStorage');
            storageSuccess = true;
          } catch(e) {
            console.error('7a. localStorage failed:', e);
          }
          
          try {
            sessionStorage.setItem('signupData', JSON.stringify(verifyData));
            console.log('7b. Saved to sessionStorage');
            storageSuccess = true;
          } catch(e) {
            console.error('7b. sessionStorage failed:', e);
          }
          
          if (!storageSuccess) {
            throw new Error('Could not save session data. Storage may be disabled.');
          }
          
          console.log('8. Navigating to verify-otp.html...');
          window.location.href = 'verify-otp.html';
          
        } catch (error) {
          console.error('=== SIGNUP ERROR ===');
          console.error('Error type:', error.name);
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);
          console.error('Full error:', error);
          
          alert('Failed to send OTP: ' + error.message);
          els.btnSignup.disabled = false;
          els.btnSignup.textContent = 'CREATE ACCOUNT';
        }
      };

      // Initialize
      loadCountries();
    });
});
