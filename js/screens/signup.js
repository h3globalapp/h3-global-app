// js/screens/signup.js - COMPLETE FIXED VERSION

// Global debug log that works even if script fails early
window.showDebugLog = function(message, type = 'info') {
  let debugDiv = document.getElementById('debug-overlay');
  if (!debugDiv) {
    debugDiv = document.createElement('div');
    debugDiv.id = 'debug-overlay';
    debugDiv.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: rgba(0,0,0,0.9);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      z-index: 99999;
      border-top: 2px solid #0f0;
    `;
    document.body.appendChild(debugDiv);
    
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Logs';
    clearBtn.style.cssText = 'position: absolute; top: 5px; right: 5px; background: #333; color: white; border: none; padding: 4px 8px; cursor: pointer;';
    clearBtn.onclick = () => debugDiv.innerHTML = '';
    debugDiv.appendChild(clearBtn);
  }
  
  const line = document.createElement('div');
  line.style.color = type === 'error' ? '#f00' : (type === 'warn' ? '#ff0' : '#0f0');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  debugDiv.appendChild(line);
  debugDiv.scrollTop = debugDiv.scrollHeight;
};

// Wait for both DOM and Firebase to be ready
async function initSignup() {
  window.showDebugLog('0. Script starting...');
  
  // Wait for Firebase to initialize (with timeout)
  let attempts = 0;
  while (!window.db && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  
  if (!window.db) {
    window.showDebugLog('FATAL: Firebase not initialized after 5 seconds!', 'error');
    alert('Firebase failed to load. Check your connection.');
    return;
  }
  
  window.showDebugLog('0b. Firebase ready, loading Firestore...');
  
  // Import Firestore
  const { collection, doc, getDocs, getDoc, addDoc, setDoc, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  
  window.showDebugLog('0c. Firestore imported');
  
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

  // CRITICAL: Prevent any default form submission
  els.form.setAttribute('onsubmit', 'return false;');
  
  // Helper: Get collection reference
  const getCol = (path) => collection(window.db, path);
  const getDocRef = (path) => doc(window.db, path);

  // Load countries from Firestore
  async function loadCountries() {
    try {
      window.showDebugLog('Loading countries...');
      const snap = await getDocs(getCol('locations'));
      const countries = snap.docs.map(d => d.id).sort();
      window.showDebugLog('Countries loaded: ' + countries.length);
      
      countries.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        els.country.appendChild(opt);
      });
    } catch (err) {
      window.showDebugLog('Error loading countries: ' + err.message, 'error');
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
      window.showDebugLog('Loading states for: ' + els.country.value);
      const snap = await getDocs(getCol(`locations/${els.country.value}/states`));
      const states = snap.docs.map(d => d.id).sort();
      window.showDebugLog('States loaded: ' + states.length);
      
      states.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        els.state.appendChild(opt);
      });
    } catch (err) {
      window.showDebugLog('Error loading states: ' + err.message, 'error');
    }
  });

  // State selected → load kennels
  els.state.addEventListener('change', async () => {
    els.kennel.innerHTML = '<option value="" disabled selected>Select Kennel</option>';
    els.kennel.disabled = false;
    els.designation.innerHTML = '<option value="" disabled selected>Select Designation</option>';
    els.designation.disabled = true;
    
    try {
      window.showDebugLog('Loading kennels...');
      const snap = await getDocs(getCol(`locations/${els.country.value}/states/${els.state.value}/kennels`));
      const kennels = snap.docs.map(d => d.id).sort();
      kennels.push('(+ Add Kennel)');
      window.showDebugLog('Kennels loaded: ' + kennels.length);
      
      kennels.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = k;
        els.kennel.appendChild(opt);
      });
    } catch (err) {
      window.showDebugLog('Error loading kennels: ' + err.message, 'error');
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

  // Load designations
  async function loadDesignations() {
    els.designation.innerHTML = '<option value="" disabled selected>Select Designation</option>';
    els.designation.disabled = false;
    
    try {
      window.showDebugLog('Loading designations...');
      const roleDoc = await getDoc(getDocRef('role/roleid'));
      const noTier = roleDoc.data()?.['No Tier'] || [];
      const tier1 = roleDoc.data()?.['Tier 1'] || [];
      const tier2 = roleDoc.data()?.['Tier 2'] || [];
      
      const kennelDoc = await getDoc(getDocRef(`designations/${els.kennel.value}`));
      const taken = kennelDoc.exists() ? Object.keys(kennelDoc.data()) : [];
      
      const adminDoc = await getDoc(getDocRef('designations/Admin'));
      const tier1Exists = adminDoc.exists();
      
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
      
      window.showDebugLog('Designations loaded: ' + allDesignations.length);
      
      allDesignations.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        els.designation.appendChild(opt);
      });
    } catch (err) {
      window.showDebugLog('Error loading designations: ' + err.message, 'error');
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
    const canonical = canonicalKennelName(rawName);
    
    const opt = document.createElement('option');
    opt.value = canonical;
    opt.textContent = canonical;
    els.kennel.insertBefore(opt, els.kennel.lastChild);
    
    els.kennel.value = canonical;
    els.modal.classList.add('hidden');
    document.getElementById('etPrefix').value = '';
    
    try {
      const { addDoc, collection } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
      const phone = document.getElementById('countryCodePicker').value + document.getElementById('etPhone').value.replace(/\D/g, '');
      
      const request = {
        requesterUid: '',
        requesterPhone: phone,
        country: els.country.value,
        state: els.state.value,
        requestedName: rawName,
        canonicalName: canonical,
        status: 'pending',
        timestamp: Timestamp.now()
      };
      
      const requestRef = await addDoc(collection(window.db, 'kennelRequests'), request);
      window.showDebugLog('Kennel request created: ' + requestRef.id);
      
      const tempId = tempKennelName(canonical);
      const tempRef = doc(window.db, `locations/${els.country.value}/states/${els.state.value}/kennels/${tempId}`);
      await setDoc(tempRef, {
        createdAt: Timestamp.now(),
        status: 'pending',
        requestedName: rawName,
        requesterPhone: phone,
        originalRequestId: requestRef.id
      });
      
      els.kennel.dataset.tempId = tempId;
      
    } catch (err) {
      window.showDebugLog('Error creating kennel: ' + err.message, 'error');
    }
    
    await loadDesignations();
  };

  // Canonical name helper
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

  // Temp kennel name generator
  function tempKennelName(requested) {
    let hash = 0;
    for (let i = 0; i < requested.length; i++) {
      const char = requested.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const unsignedHash = hash >>> 0;
    const base36 = unsignedHash.toString(36).toUpperCase();
    return `PENDING-${base36}`;
  }

  // CRITICAL: Form submit with preventDefault
  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    window.showDebugLog('=== FORM SUBMIT START ===');
    
    els.btnSignup.disabled = true;
    els.btnSignup.textContent = 'Sending OTP...';
    
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
    
    window.showDebugLog('Phone: ' + signupData.phone);
    window.showDebugLog('Country: ' + signupData.country);
    window.showDebugLog('State: ' + signupData.state);
    window.showDebugLog('Kennel: ' + signupData.kennel);
    
    // Validate
    if (!signupData.hashHandle || !signupData.firstName || !signupData.lastName || 
        !signupData.phone || !signupData.country || !signupData.state || 
        !signupData.kennel || !signupData.designation) {
      window.showDebugLog('VALIDATION FAILED', 'error');
      alert('Please fill all fields');
      els.btnSignup.disabled = false;
      els.btnSignup.textContent = 'CREATE ACCOUNT';
      return;
    }
    
    // Check phone exists
    try {
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
      const phoneRef = doc(window.db, 'phoneNumbers', signupData.phone);
      const phoneDoc = await getDoc(phoneRef);
      
      if (phoneDoc.exists()) {
        window.showDebugLog('Phone already exists', 'warn');
        // Show dialog...
        const dialog = document.createElement('div');
        dialog.innerHTML = `<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;">
          <div style="background:white;padding:24px;border-radius:16px;text-align:center;">
            <h3>Already Registered</h3>
            <p>This phone is already registered.</p>
            <button onclick="this.closest('.modal').remove()">Stay</button>
            <button onclick="sessionStorage.setItem('pendingLoginPhone','${signupData.phone}');window.location.href='login.html'">Login</button>
          </div>
        </div>`;
        dialog.className = 'modal';
        document.body.appendChild(dialog);
        els.btnSignup.disabled = false;
        els.btnSignup.textContent = 'CREATE ACCOUNT';
        return;
      }
    } catch (err) {
      window.showDebugLog('Phone check error: ' + err.message, 'error');
    }
    
    // Send OTP
    try {
      window.showDebugLog('Importing functions...');
      const { httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js");
      const { functions } = await import('../firebase-config.js');
      
      window.showDebugLog('Calling sendOtpTermii...');
      const sendOtpTermii = httpsCallable(functions, 'sendOtpTermii');
      const result = await sendOtpTermii({
        phone: signupData.phone,
        firstName: signupData.firstName,
        lastName: signupData.lastName
      });
      
      window.showDebugLog('Result: ' + JSON.stringify(result.data));
      
      const { pin_id } = result.data;
      if (!pin_id) {
        throw new Error('No pin_id received');
      }
      
      // Store data
      const verifyData = {
        ...signupData,
        pinId: pin_id,
        isFirebase: false,
        isSignup: true,
        otpSentAt: Date.now()
      };
      
      sessionStorage.setItem('signupData', JSON.stringify(verifyData));
      window.showDebugLog('Data stored. SUCCESS!', 'info');
      
      // DEBUG: Stay on page
      alert(`✅ OTP sent! Pin: ${pin_id}\n\nCheck debug log at bottom.`);
      
      // PRODUCTION: Uncomment to redirect
      // window.location.href = 'verify-otp.html';
      
    } catch (error) {
      window.showDebugLog('ERROR: ' + error.message, 'error');
      console.error(error);
      alert('Error: ' + error.message);
    } finally {
      els.btnSignup.disabled = false;
      els.btnSignup.textContent = 'CREATE ACCOUNT';
    }
  });

  // Initialize
  loadCountries();
}

// Start initialization
initSignup().catch(err => {
  console.error('Init failed:', err);
  window.showDebugLog('Init failed: ' + err.message, 'error');
});