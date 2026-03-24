import { collection, doc, getDoc, getDocs, setDoc, addDoc, Timestamp, query, where, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// DEBUG: Check URL parameters
console.log('URL:', window.location.href);
console.log('Search params:', window.location.search);
const urlParams = new URLSearchParams(window.location.search);
const editEventId = urlParams.get('edit');
console.log('editEventId:', editEventId);
const isEditMode = !!editEventId;
console.log('isEditMode:', isEditMode);

// Global variables
let selectedImageFile = null;
let selectedLat = null;
let selectedLng = null;
let latLngFromGPS = false;
let isTier1Admin = false;
let map = null;
let marker = null;
let placesAutocomplete = null;
const accommodationRows = [];


// Global map elements reference
window.mapEls = null;

// Define initMap EARLY (before Google Maps script loads)


// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  
  // Get elements
  const els = {
    country: document.getElementById('actvCountry'),
    state: document.getElementById('actvState'),
    kennel: document.getElementById('actvKennel'),
    fileInput: document.getElementById('fileInput'),
    previewImg: document.getElementById('previewImg'),
    placeholder: document.querySelector('.image-preview .placeholder'),
    btnSelectImage: document.getElementById('btnSelectImage'),
    btnSave: document.getElementById('btnSaveRun'),
    progress: document.getElementById('progressSave'),
    accContainer: document.getElementById('accommodationContainer'),
    address: document.getElementById('actvAddress'),
    btnSearchLocation: document.getElementById('btnSearchLocation'),
    btnSaveLocation: document.getElementById('btnSaveLocation'),
    btnUseCurrentLocation: document.getElementById('btnUseCurrentLocation'),
    mapContainer: document.getElementById('map'),
   // sponsorshipContainer: document.getElementById('sponsorshipContainer'),
    chkEarlyBirdEnabled: document.getElementById('chkEarlyBirdEnabled'),
    earlyBirdSection: document.getElementById('earlyBirdSection'),
    etEarlyBirdDeadline: document.getElementById('etEarlyBirdDeadline'),
    etEarlyBirdMaxSlots: document.getElementById('etEarlyBirdMaxSlots'),
    etEarlyBirdRegoFee: document.getElementById('etEarlyBirdRegoFee'),
    etRegularRegoFee: document.getElementById('etRegularRegoFee')
  };
  
  // Store globally for initMap callback
  window.mapEls = els;
  
  // Setup event listeners
  setupEventListeners(els);
  
  // Initialize app
  initApp(els);
  
  // Check if Google Maps already loaded
  if (typeof google !== 'undefined' && google.maps) {
    console.log('Google Maps already loaded, initializing now...');
    initializeMap(els);
  }
});

window.initializeMap = function(els) {
  console.log('Initializing map...');
  
  if (!els || !els.mapContainer) {
    console.error('Map container not found!');
    return;
  }
  
  if (map) {
    console.log('Map already initialized');
    return;
  }
  
  const defaultLoc = { lat: 9.082, lng: 8.6753 };
  
  try {
    map = new google.maps.Map(els.mapContainer, {
      center: defaultLoc,
      zoom: 6,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
    
    marker = new google.maps.Marker({
      position: defaultLoc,
      map: map,
      draggable: true,
      animation: google.maps.Animation.DROP
    });
    
    map.addListener('click', (e) => {
      latLngFromGPS = false;
      marker.setPosition(e.latLng);
      selectedLat = e.latLng.lat();
      selectedLng = e.latLng.lng();
      reverseGeocode(e.latLng, els);
      toggleSaveLocation(els);
      console.log('Map clicked:', selectedLat, selectedLng);
    });
    
    marker.addListener('dragend', (e) => {
      latLngFromGPS = false;
      selectedLat = e.latLng.lat();
      selectedLng = e.latLng.lng();
      reverseGeocode(e.latLng, els);
      toggleSaveLocation(els);
      console.log('Marker dragged:', selectedLat, selectedLng);
    });
    
    setupPlacesAutocomplete(els);
    
    console.log('Map initialized successfully');
    
  } catch (err) {
    console.error('Map initialization error:', err);
    els.mapContainer.innerHTML = '<p style="padding:20px;text-align:center;color:#f44336;">Error loading map. Please check API key.</p>';
  }
};

async function loadSavedPlacesForAutocomplete(els) {
  try {
    onSnapshot(
      query(collection(window.db, 'saved_places'), orderBy('name')),
      (snap) => {
        const savedPlaces = snap.docs.map(d => d.data().name);
        
        const datalist = document.getElementById('savedPlacesList');
        if (datalist) {
          datalist.innerHTML = savedPlaces.map(name => 
            `<option value="${name}">`
          ).join('');
        }
      }
    );
  } catch (err) {
    console.error('Error loading saved places:', err);
  }
}

function setupPlacesAutocomplete(els) {
  if (!google.maps.places) {
    console.log('Places library not loaded');
    return;
  }
  
  console.log('Setting up Places autocomplete...');
  
  try {
    placesAutocomplete = new google.maps.places.Autocomplete(els.address, {
      types: ['geocode', 'establishment']
    });
    
    placesAutocomplete.bindTo('bounds', map);
    
    placesAutocomplete.addListener('place_changed', async () => {
      const place = placesAutocomplete.getPlace();
      
      if (place.geometry) {
        latLngFromGPS = false;
        const loc = place.geometry.location;
        map.setCenter(loc);
        map.setZoom(15);
        marker.setPosition(loc);
        selectedLat = loc.lat();
        selectedLng = loc.lng();
        toggleSaveLocation(els);
        console.log('Google Place selected:', place.name, selectedLat, selectedLng);
        return;
      }
      
      console.log('No geometry, checking saved places...');
      const name = els.address.value.trim();
      
      if (name) {
        try {
          const docRef = doc(window.db, 'saved_places', name.toLowerCase().replace(/\s+/g, '-'));
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const data = docSnap.data();
            latLngFromGPS = false;
            const loc = { lat: data.lat, lng: data.lng };
            map.setCenter(loc);
            map.setZoom(15);
            marker.setPosition(loc);
            selectedLat = data.lat;
            selectedLng = data.lng;
            toggleSaveLocation(els);
            console.log('Saved place found:', name, selectedLat, selectedLng);
          }
        } catch (err) {
          console.error('Error checking saved place:', err);
        }
      }
    });
    
    loadSavedPlacesForAutocomplete(els);
    
  } catch (err) {
    console.error('Error setting up Places autocomplete:', err);
  }
}

function reverseGeocode(latLng, els) {
  if (!google.maps.Geocoder) return;
  
  if (!map || !marker) {
    console.log('Map not ready for reverse geocoding');
    return;
  }
  
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: latLng }, (results, status) => {
    if (status === 'OK' && results[0]) {
      els.address.value = results[0].formatted_address;
      console.log('Address found:', results[0].formatted_address);
    } else {
      console.log('Geocode failed:', status);
    }
  });
}

function toggleSaveLocation(els) {
  console.log('DEBUG toggleSaveLocation called:');
  console.log('  latLngFromGPS:', latLngFromGPS);
  console.log('  selectedLat:', selectedLat);
  console.log('  selectedLng:', selectedLng);
  console.log('  btnSaveLocation element:', els.btnSaveLocation);
  
  if (selectedLat != null && selectedLng != null && latLngFromGPS) {
    console.log('  -> SHOWING button');
    els.btnSaveLocation.classList.remove('hidden');
  } else {
    console.log('  -> HIDING button because:');
    if (selectedLat == null) console.log('     selectedLat is null');
    if (selectedLng == null) console.log('     selectedLng is null');
    if (!latLngFromGPS) console.log('     latLngFromGPS is false');
    els.btnSaveLocation.classList.add('hidden');
  }
}

function setupEventListeners(els) {
  // Image selection
  els.btnSelectImage.onclick = () => els.fileInput.click();
  els.fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedImageFile = file;
    const url = URL.createObjectURL(file);
    els.previewImg.src = url;
    els.previewImg.classList.remove('hidden');
    els.placeholder.classList.add('hidden');
  };
  
  // Early bird toggle
  els.chkEarlyBirdEnabled.onchange = () => {
    if (els.chkEarlyBirdEnabled.checked) {
      els.earlyBirdSection.classList.remove('hidden');
    } else {
      els.earlyBirdSection.classList.add('hidden');
    }
  };
  
  // Search location by address
  els.btnSearchLocation.onclick = () => {
    latLngFromGPS = false;
    const address = els.address.value.trim();
    if (!address) {
      alert('Please enter an address');
      return;
    }
    
    if (!google.maps.Geocoder) {
      alert('Map not ready yet');
      return;
    }
    
    if (!map) {
      alert('Map is still loading. Please wait a moment and try again.');
      return;
    }
    
    console.log('Searching for:', address);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: address }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        map.setCenter(loc);
        map.setZoom(15);
        marker.setPosition(loc);
        selectedLat = loc.lat();
        selectedLng = loc.lng();
        toggleSaveLocation(els);
        console.log('Location found:', loc.lat(), loc.lng());
      } else {
        alert('Location not found: ' + status);
      }
    });
  };
  
  // Use current location
  els.btnUseCurrentLocation.onclick = () => {
    console.log('Requesting current location...');
    
    if (!navigator.geolocation) {
      alert('Geolocation not supported by your browser');
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('Got position:', position.coords);
        latLngFromGPS = true;
        const loc = { 
          lat: position.coords.latitude, 
          lng: position.coords.longitude 
        };
        
        if (map) {
          map.setCenter(loc);
          map.setZoom(15);
          marker.setPosition(loc);
        }
        selectedLat = loc.lat;
        selectedLng = loc.lng;
        reverseGeocode(loc, els);
        toggleSaveLocation(els);
      },
      (error) => {
        console.error('Geolocation error:', error);
        alert('Could not get location: ' + error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };
  
  // Save location
  els.btnSaveLocation.onclick = async () => {
    if (!latLngFromGPS) {
      alert('Only GPS locations can be saved');
      return;
    }
    
    const name = els.address.value.trim();
    if (!name || selectedLat == null || selectedLng == null) {
      alert('Address or location missing');
      return;
    }
    
    const key = name.toLowerCase().replace(/\s+/g, '-');
    
    try {
      const existing = await getDoc(doc(window.db, 'saved_places', key));
      if (existing.exists()) {
        alert('Already saved');
        return;
      }
      
      const q = query(
        collection(window.db, 'saved_places'),
        where('lat', '==', selectedLat),
        where('lng', '==', selectedLng),
        limit(1)
      );
      const dupes = await getDocs(q);
      if (!dupes.empty) {
        alert('Same coordinates exist');
        return;
      }
      
      await setDoc(doc(window.db, 'saved_places', key), {
        name: name,
        lat: selectedLat,
        lng: selectedLng,
        createdAt: Timestamp.now()
      });
      
      alert('Location saved to book');
      
    } catch (err) {
      console.error('Save location error:', err);
      alert('Error saving location');
    }
  };
  
  // Add accommodation row
  document.getElementById('btnAddAccommodation').onclick = () => addAccommodationRow(els);
  

  
  // Form submit
  document.getElementById('eventForm').onsubmit = async (e) => {
    e.preventDefault();
    await saveEvent(els);
  };
}

function addAccommodationRow(els, existing = null) {
  const row = existing || { roomType: '', amount: 0, qty: 1 };
  accommodationRows.push(row);
  
  const div = document.createElement('div');
  div.className = 'accommodation-row';
  div.innerHTML = `
    <input type="text" placeholder="Room Type" value="${row.roomType}" class="room-type"/>
    <input type="number" placeholder="Amount per night" value="${row.amount || ''}" step="0.01" min="0" class="amount"/>
    <input type="number" placeholder="Available rooms" value="${row.qty}" min="1" class="qty"/>
    <button type="button" class="btn-delete" aria-label="Delete">×</button>
  `;
  
  div.querySelector('.room-type').oninput = (e) => row.roomType = e.target.value;
  div.querySelector('.amount').oninput = (e) => row.amount = parseFloat(e.target.value) || 0;
  div.querySelector('.qty').oninput = (e) => row.qty = parseInt(e.target.value) || 1;
  div.querySelector('.btn-delete').onclick = () => {
    div.remove();
    const idx = accommodationRows.indexOf(row);
    if (idx > -1) accommodationRows.splice(idx, 1);
  };
  
  els.accContainer.appendChild(div);
}



async function initApp(els) {
  onAuthStateChanged(window.auth, async (user) => {
    if (!user) {
      console.log('No user logged in, redirecting...');
      window.location.href = 'login.html';
      return;
    }
    
    console.log('Current user:', user.uid);
    console.log('initApp - isEditMode:', isEditMode, 'editEventId:', editEventId);
    
    try {
      const userDoc = await getDoc(doc(window.db, 'users', user.uid));
      const userData = userDoc.data();
      
      isTier1Admin = userData?.role === 'Tier 1';
      
      if (isTier1Admin) {
        els.country.disabled = false;
        els.state.disabled = false;
        els.kennel.disabled = false;
        await loadCountries();
        setupTier1Listeners(els);
      } else {
        els.country.value = userData?.country || '';
        els.state.value = userData?.state || '';
        els.kennel.value = userData?.kennel || '';
        els.country.disabled = true;
        els.state.disabled = true;
        els.kennel.disabled = true;
      }
      
      const usersSnap = await getDocs(collection(window.db, 'users'));
      const handles = usersSnap.docs.map(d => d.data().hashHandle).filter(Boolean).sort();
      document.getElementById('hashersList').innerHTML = handles.map(h => `<option value="${h}">`).join('');
      
      addAccommodationRow(els);
   
      
      if (isEditMode) {
        console.log('Calling loadExistingEvent with ID:', editEventId);
        await loadExistingEvent(els, editEventId);
        console.log('loadExistingEvent completed');
      }
      
    } catch (err) {
      console.error('Error initializing app:', err);
      alert('Error loading data. Please try again.');
    }
  });
}

function setupTier1Listeners(els) {
  els.country.addEventListener('change', async () => {
    const country = els.country.value;
    els.state.value = '';
    els.kennel.value = '';
    
    if (!country) return;
    
    try {
      const snap = await getDocs(collection(window.db, `locations/${country}/states`));
      const states = snap.docs.map(d => d.id).sort();
      document.getElementById('stateList').innerHTML = states.map(s => `<option value="${s}">`).join('');
    } catch (err) {
      console.error('Error loading states:', err);
    }
  });
  
  els.state.addEventListener('change', async () => {
    const country = els.country.value;
    const state = els.state.value;
    els.kennel.value = '';
    
    if (!country || !state) return;
    
    try {
      const snap = await getDocs(collection(window.db, `locations/${country}/states/${state}/kennels`));
      const kennels = snap.docs.map(d => d.id).sort();
      document.getElementById('kennelList').innerHTML = kennels.map(k => `<option value="${k}">`).join('');
    } catch (err) {
      console.error('Error loading kennels:', err);
    }
  });
}

async function loadCountries() {
  try {
    const snap = await getDocs(collection(window.db, 'locations'));
    const countries = snap.docs.map(d => d.id).sort();
    document.getElementById('countryList').innerHTML = countries.map(c => `<option value="${c}">`).join('');
  } catch (err) {
    console.error('Error loading countries:', err);
  }
}

async function loadExistingEvent(els, eventId) {
  try {
    const snap = await getDoc(doc(window.db, 'events', eventId));
    if (!snap.exists()) return;
    
    const data = snap.data();
    
    // Basic info
    document.getElementById('etRunTitle').value = data.title || '';
    els.country.value = data.country || '';
    els.state.value = data.state || '';
    els.kennel.value = data.kennel || '';
    document.getElementById('etStartDate').value = data.startDate || '';
    document.getElementById('etEndDate').value = data.endDate || '';
    document.getElementById('etRunTime').value = data.time || '';
    els.address.value = data.address || '';
    document.getElementById('actvCurrency').value = data.currency || 'USD';
	document.getElementById('etSponsorship').value = data.sponsorship || '';
    document.getElementById('etWhatToExpect').value = data.whatToExpect || '';
    document.getElementById('actvSignedBy').value = data.signedBy || '';
    
    // Load new pricing structure
    if (data.pricing) {
      const p = data.pricing;
      
      // Early bird
      if (p.earlyBird && p.earlyBird.enabled) {
        els.chkEarlyBirdEnabled.checked = true;
        els.earlyBirdSection.classList.remove('hidden');
        els.etEarlyBirdDeadline.value = p.earlyBird.deadline || '';
        els.etEarlyBirdMaxSlots.value = p.earlyBird.maxSlots || '';
        els.etEarlyBirdRegoFee.value = p.earlyBird.regoFee || '';
      }
      
      // Regular pricing
      els.etRegularRegoFee.value = p.regular?.regoFee || '';
      
     
      
      // Accommodation
      els.accContainer.innerHTML = '';
      accommodationRows.length = 0;
      if (p.regular?.accommodation && p.regular.accommodation.length > 0) {
        p.regular.accommodation.forEach(acc => {
          addAccommodationRow(els, acc);
        });
      } else {
        addAccommodationRow(els);
      }
    } else {
      // Legacy data loading
      els.etRegularRegoFee.value = data.regoFee || '';
    }
    
    // Image
    if (data.imageUrl) {
      els.previewImg.src = data.imageUrl;
      els.previewImg.classList.remove('hidden');
      els.placeholder.classList.add('hidden');
    }
    
    // Map location
    if (data.lat && data.lng && map) {
      selectedLat = data.lat;
      selectedLng = data.lng;
      latLngFromGPS = false;
      const loc = { lat: data.lat, lng: data.lng };
      map.setCenter(loc);
      map.setZoom(15);
      marker.setPosition(loc);
    }
    
  } catch (err) {
    console.error('Error loading existing event:', err);
  }
}

async function saveEvent(els) {
  els.btnSave.disabled = true;
  els.progress.classList.remove('hidden');
  
  try {
    // Build pricing object
    const pricing = {
      currency: document.getElementById('actvCurrency').value,
      earlyBird: {
        enabled: els.chkEarlyBirdEnabled.checked,
        deadline: els.chkEarlyBirdEnabled.checked ? els.etEarlyBirdDeadline.value : null,
        maxSlots: els.chkEarlyBirdEnabled.checked ? (parseInt(els.etEarlyBirdMaxSlots.value) || null) : null,
        regoFee: els.chkEarlyBirdEnabled.checked ? (parseFloat(els.etEarlyBirdRegoFee.value) || 0) : 0
      },
      regular: {
        regoFee: parseFloat(els.etRegularRegoFee.value) || 0,
        accommodation: accommodationRows.filter(r => r.roomType).map(r => ({
          roomType: r.roomType,
          amount: r.amount,
          qty: r.qty
        }))
      },
     
    };
    
    const formData = {
      title: document.getElementById('etRunTitle').value,
      country: els.country.value,
      state: els.state.value,
      kennel: els.kennel.value,
      startDate: document.getElementById('etStartDate').value,
      endDate: document.getElementById('etEndDate').value,
      time: document.getElementById('etRunTime').value,
      address: els.address.value,
      lat: selectedLat,
      lng: selectedLng,
      pricing: pricing,
	    sponsorship: document.getElementById('etSponsorship').value,  // <-- ADD THIS LINE HERE
      whatToExpect: document.getElementById('etWhatToExpect').value,
      signedBy: document.getElementById('actvSignedBy').value,
      createdBy: window.auth.currentUser?.uid || '',
      createdAt: Timestamp.now(),
      // Initialize registration counters
      earlyBirdRegistrations: 0,
      totalRegistrations: 0
    };
    
    // Upload image if selected
    if (selectedImageFile) {
      const storageRef = ref(window.storage, `events/${Date.now()}_${selectedImageFile.name}`);
      await uploadBytes(storageRef, selectedImageFile);
      formData.imageUrl = await getDownloadURL(storageRef);
    }
    
    // Save to Firestore
    if (isEditMode) {
      await setDoc(doc(window.db, 'events', editEventId), formData, { merge: true });
    } else {
      await addDoc(collection(window.db, 'events'), formData);
    }
    
    alert('Event saved successfully!');
    window.location.href = 'events.html';
    
  } catch (err) {
    console.error('Save error:', err);
    alert('Error saving event: ' + err.message);
    els.btnSave.disabled = false;
    els.progress.classList.add('hidden');
  }
}