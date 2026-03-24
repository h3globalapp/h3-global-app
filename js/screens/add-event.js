import { collection, doc, getDoc, getDocs, setDoc, addDoc, Timestamp, query, where, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js ";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js  ";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js ";

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
// ADD THIS: Global array to store collaborating kennels
let collaboratingKennels = [];
// ADD THIS: Cropper variables for event image
let eventImageCropper = null;
let eventImageCropperModal = null;
// ADD THIS: Global array for multi-select signers (collaboration mode)
let selectedSigners = [];
const MAX_SIGNERS = 5;

// Account details storage
let accountDetails = {
  useSameAccount: true,
  registration: { accNo: '', accName: '', bank: '' },
  sponsorship: { accNo: '', accName: '', bank: '' },
  accommodation: { accNo: '', accName: '', bank: '' }
};

// Track if account details have been saved
let accountDetailsSaved = false;

// Available hashers for Signed By dropdown - stores hashHandle and designation
let availableHashers = [];

// Global map elements reference
window.mapEls = null;

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
    chkEarlyBirdEnabled: document.getElementById('chkEarlyBirdEnabled'),
    earlyBirdSection: document.getElementById('earlyBirdSection'),
    etEarlyBirdDeadline: document.getElementById('etEarlyBirdDeadline'),
    etEarlyBirdMaxSlots: document.getElementById('etEarlyBirdMaxSlots'),
    etEarlyBirdRegoFee: document.getElementById('etEarlyBirdRegoFee'),
    etRegularRegoFee: document.getElementById('etRegularRegoFee'),
    btnOpenAccountDialog: document.getElementById('btnOpenAccountDialog'),
    accountDialog: document.getElementById('accountDialog'),
    btnCloseAccountDialog: document.getElementById('btnCloseAccountDialog'),
    btnSaveAccountDetails: document.getElementById('btnSaveAccountDetails'),
    chkSameAccount: document.getElementById('chkSameAccount'),
    dlgSponsorshipSection: document.getElementById('dlgSponsorshipSection'),
    dlgAccommodationSection: document.getElementById('dlgAccommodationSection'),
    dlgRegAccNo: document.getElementById('dlgRegAccNo'),
    dlgRegAccName: document.getElementById('dlgRegAccName'),
    dlgRegBank: document.getElementById('dlgRegBank'),
    dlgSponsorAccNo: document.getElementById('dlgSponsorAccNo'),
    dlgSponsorAccName: document.getElementById('dlgSponsorAccName'),
    dlgSponsorBank: document.getElementById('dlgSponsorBank'),
    dlgAccAccNo: document.getElementById('dlgAccAccNo'),
    dlgAccAccName: document.getElementById('dlgAccAccName'),
    dlgAccBank: document.getElementById('dlgAccBank'),
    accountDetailsSummary: document.getElementById('accountDetailsSummary'),
      signedBy: document.getElementById('actvSignedBy'),  // Single kennel: <select>
    signedByContainer: document.getElementById('signedByContainer'), // ADD THIS: Container for both modes
    signedByMultiWrapper: document.getElementById('signedByMultiWrapper'), // ADD THIS: Multi-select wrapper
    signedByChipsContainer: document.getElementById('signedByChipsContainer'), // ADD THIS: Chips container
    signedByMultiInput: document.getElementById('signedByMultiInput'), // ADD THIS: Multi-select input
    signedByDropdown: document.getElementById('signedByDropdown'), // ADD THIS: Dropdown element
	    signedBy: document.getElementById('actvSignedBy'),  // Single kennel: <select>
    etEventDetails: document.getElementById('etEventDetails'), // ADD THIS: Event details textarea
    signedByContainer: document.getElementById('signedByContainer'), // ADD THIS: Container for both modes
// ADD THIS: Collaboration elements
chkCollaboration: document.getElementById('chkCollaboration'),
collaborationSection: document.getElementById('collaborationSection'),
kennelChipsContainer: document.getElementById('kennelChipsContainer'),
btnAddCollaboratingKennel: document.getElementById('btnAddCollaboratingKennel'),
collaborationTemplate: document.getElementById('collaborationKennelTemplate'),
// ADD THIS: Cropper elements (will be created dynamically)
cropperModal: null,
cropperImage: null,
zoomSlider: null
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

// Image selection with cropping (similar to profile picture)
function setupEventListeners(els) {
  els.btnSelectImage.onclick = () => els.fileInput.click();
  els.fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be less than 10MB');
      return;
    }
    
    // Read file and open cropper
    const reader = new FileReader();
    reader.onload = (event) => {
      openEventImageCropper(els, event.target.result);
    };
    reader.onerror = () => {
      alert('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };
  
  // Early bird toggle
  els.chkEarlyBirdEnabled.onchange = () => {
    if (els.chkEarlyBirdEnabled.checked) {
      els.earlyBirdSection.classList.remove('hidden');
    } else {
      els.earlyBirdSection.classList.add('hidden');
    }
  };
  
  // Account Dialog
  els.btnOpenAccountDialog.onclick = () => {
    els.chkSameAccount.checked = accountDetails.useSameAccount;
    els.dlgRegAccNo.value = accountDetails.registration.accNo;
    els.dlgRegAccName.value = accountDetails.registration.accName;
    els.dlgRegBank.value = accountDetails.registration.bank;
    els.dlgSponsorAccNo.value = accountDetails.sponsorship.accNo;
    els.dlgSponsorAccName.value = accountDetails.sponsorship.accName;
    els.dlgSponsorBank.value = accountDetails.sponsorship.bank;
    els.dlgAccAccNo.value = accountDetails.accommodation.accNo;
    els.dlgAccAccName.value = accountDetails.accommodation.accName;
    els.dlgAccBank.value = accountDetails.accommodation.bank;
    if (accountDetails.useSameAccount) {
      els.dlgSponsorshipSection.classList.add('hidden');
      els.dlgAccommodationSection.classList.add('hidden');
    } else {
      els.dlgSponsorshipSection.classList.remove('hidden');
      els.dlgAccommodationSection.classList.remove('hidden');
    }
    els.accountDialog.classList.remove('hidden');
    els.accountDialog.style.display = 'flex';
  };
  
  els.btnCloseAccountDialog.onclick = () => {
    els.accountDialog.classList.add('hidden');
    els.accountDialog.style.display = 'none';
  };
  
  els.chkSameAccount.onchange = () => {
    if (els.chkSameAccount.checked) {
      els.dlgSponsorshipSection.classList.add('hidden');
      els.dlgAccommodationSection.classList.add('hidden');
    } else {
      els.dlgSponsorshipSection.classList.remove('hidden');
      els.dlgAccommodationSection.classList.remove('hidden');
    }
  };
  
  els.btnSaveAccountDetails.onclick = () => {
    // Validate account details before saving
    const regNo = els.dlgRegAccNo.value.trim();
    const regName = els.dlgRegAccName.value.trim();
    const regBank = els.dlgRegBank.value.trim();
    
    if (!regNo || !regName || !regBank) {
      alert('Please fill in all Registration Payment fields');
      return;
    }
    
    accountDetails.useSameAccount = els.chkSameAccount.checked;
    accountDetails.registration = {
      accNo: regNo,
      accName: regName,
      bank: regBank
    };
    
    if (!accountDetails.useSameAccount) {
      const sponsorNo = els.dlgSponsorAccNo.value.trim();
      const sponsorName = els.dlgSponsorAccName.value.trim();
      const sponsorBank = els.dlgSponsorBank.value.trim();
      const accNo = els.dlgAccAccNo.value.trim();
      const accName = els.dlgAccAccName.value.trim();
      const accBank = els.dlgAccBank.value.trim();
      
      if (!sponsorNo || !sponsorName || !sponsorBank) {
        alert('Please fill in all Sponsorship Payment fields');
        return;
      }
      if (!accNo || !accName || !accBank) {
        alert('Please fill in all Accommodation Payment fields');
        return;
      }
      
      accountDetails.sponsorship = {
        accNo: sponsorNo,
        accName: sponsorName,
        bank: sponsorBank
      };
      accountDetails.accommodation = {
        accNo: accNo,
        accName: accName,
        bank: accBank
      };
    } else {
      accountDetails.sponsorship = { ...accountDetails.registration };
      accountDetails.accommodation = { ...accountDetails.registration };
    }
    
    accountDetailsSaved = true;
    els.accountDetailsSummary.classList.remove('hidden');
    els.accountDialog.classList.add('hidden');
    els.accountDialog.style.display = 'none';
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
  
  // ADD THIS: Collaboration checkbox toggle
// REPLACE the existing els.chkCollaboration.onchange handler with this:

els.chkCollaboration.onchange = () => {
  const countryGroup = els.country.closest('.input-group');
  const stateGroup = els.state.closest('.input-group');
  const kennelGroup = els.kennel.closest('.input-group');

  if (els.chkCollaboration.checked) {
    els.collaborationSection.classList.remove('hidden');
    
    if (countryGroup) countryGroup.classList.add('hidden');
    if (stateGroup) stateGroup.classList.add('hidden');
    if (kennelGroup) kennelGroup.classList.add('hidden');
    
    els.country.disabled = true;
    els.state.disabled = true;
    els.kennel.disabled = true;
    els.country.required = false;
    els.state.required = false;
    els.kennel.required = false;
    
    if (collaboratingKennels.length === 0) {
      addCollaborationKennelRow(els);
    }
    
    // Switch to multi-select signed by
    els.signedBy.classList.add('hidden');
    els.signedBy.required = false;  // Remove HTML5 required
    els.signedByMultiWrapper.classList.remove('hidden');
    // DON'T set required on multi-input - we validate via JS only
    
    if (!els.signedByMultiWrapper.dataset.initialized) {
      setupSignedByMultiSelect(els);
      els.signedByMultiWrapper.dataset.initialized = 'true';
    }
  } else {
    els.collaborationSection.classList.add('hidden');
    collaboratingKennels = [];
    els.kennelChipsContainer.innerHTML = '';
    
    if (countryGroup) countryGroup.classList.remove('hidden');
    if (stateGroup) stateGroup.classList.remove('hidden');
    if (kennelGroup) kennelGroup.classList.remove('hidden');
    
    els.country.disabled = false;
    els.state.disabled = false;
    els.kennel.disabled = false;
    els.country.required = true;
    els.state.required = true;
    els.kennel.required = true;
    
    // Switch back to single dropdown
    els.signedBy.classList.remove('hidden');
    els.signedBy.required = true;  // Add HTML5 required back
    els.signedByMultiWrapper.classList.add('hidden');
    
    // Clear selected signers
    selectedSigners = [];
    els.signedByChipsContainer.innerHTML = '';
  }
};

// ADD THIS: Add collaborating kennel button
els.btnAddCollaboratingKennel.onclick = () => {
  addCollaborationKennelRow(els);
};
  
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

// REPLACE ONLY the addCollaborationKennelRow function (around line 400-500)
// Keep the existing loadCountriesForSelect, loadStatesForSelect, loadKennelsForSelect as they are

function addCollaborationKennelRow(els, existingData = null) {
  const kennelData = existingData || { country: '', state: '', kennel: '' };
  
  // Add to array immediately so we can track it
  collaboratingKennels.push(kennelData);
  const rowIndex = collaboratingKennels.length - 1;
  
  const row = document.createElement('div');
  row.className = 'collab-kennel-row';
  row.dataset.index = rowIndex;
  row.innerHTML = `
    <select class="collab-country" required>
      <option value="">Select Country</option>
    </select>
    <select class="collab-state" disabled required>
      <option value="">Select State</option>
    </select>
    <select class="collab-kennel" disabled required>
      <option value="">Select Kennel</option>
    </select>
    <button type="button" class="btn-remove-kennel" aria-label="Remove">×</button>
  `;
  
  const countrySelect = row.querySelector('.collab-country');
  const stateSelect = row.querySelector('.collab-state');
  const kennelSelect = row.querySelector('.collab-kennel');
  const removeBtn = row.querySelector('.btn-remove-kennel');
  
  // Store references to selects on the kennelData for easier access
  kennelData._elements = { countrySelect, stateSelect, kennelSelect };
  
  // Internal async cascade function
  const cascadeLoad = async () => {
    // Step 1: Load countries
    await loadCountriesForSelect(countrySelect);
    
    // If we have existing country, set it and load states
    if (existingData && existingData.country) {
      const countryOption = countrySelect.querySelector(`option[value="${existingData.country}"]`);
      if (countryOption) {
        countrySelect.value = existingData.country;
        kennelData.country = existingData.country;
        
        // Step 2: Load states for this country
        await loadStatesForSelect(existingData.country, stateSelect, null);
        stateSelect.disabled = false;
        
        // If we have existing state, set it and load kennels
        if (existingData.state) {
          const stateOption = stateSelect.querySelector(`option[value="${existingData.state}"]`);
          if (stateOption) {
            stateSelect.value = existingData.state;
            kennelData.state = existingData.state;
            
            // Step 3: Load kennels for this state
            await loadKennelsForSelect(existingData.country, existingData.state, kennelSelect, null);
            kennelSelect.disabled = false;
            
            // If we have existing kennel, set it
            if (existingData.kennel) {
              const kennelOption = kennelSelect.querySelector(`option[value="${existingData.kennel}"]`);
              if (kennelOption) {
                kennelSelect.value = existingData.kennel;
                kennelData.kennel = existingData.kennel;
                console.log('Successfully set kennel to:', existingData.kennel);
              } else {
                console.warn('Kennel option not found:', existingData.kennel);
              }
            }
          } else {
            console.warn('State option not found:', existingData.state);
          }
        }
      } else {
        console.warn('Country option not found:', existingData.country);
      }
    }
  };
  
  // Start the cascade
  cascadeLoad().catch(err => {
    console.error('Error in cascade load:', err);
  });
  
  // Country change handler
  countrySelect.onchange = async () => {
    kennelData.country = countrySelect.value;
    stateSelect.innerHTML = '<option value="">Select State</option>';
    kennelSelect.innerHTML = '<option value="">Select Kennel</option>';
    kennelSelect.disabled = true;
    kennelData.state = '';
    kennelData.kennel = '';
    
    if (countrySelect.value) {
      await loadStatesForSelect(countrySelect.value, stateSelect, null);
      stateSelect.disabled = false;
    } else {
      stateSelect.disabled = true;
    }
  };
  
  // State change handler
  stateSelect.onchange = async () => {
    kennelData.state = stateSelect.value;
    kennelSelect.innerHTML = '<option value="">Select Kennel</option>';
    kennelData.kennel = '';
    
    if (stateSelect.value) {
      await loadKennelsForSelect(countrySelect.value, stateSelect.value, kennelSelect, null);
      kennelSelect.disabled = false;
    } else {
      kennelSelect.disabled = true;
    }
  };
  
  // Kennel change handler
  kennelSelect.onchange = () => {
    kennelData.kennel = kennelSelect.value;
  };
  
  // Remove handler
  removeBtn.onclick = () => {
    row.remove();
    const idx = collaboratingKennels.indexOf(kennelData);
    if (idx > -1) collaboratingKennels.splice(idx, 1);
  };
  
  els.kennelChipsContainer.appendChild(row);
  
  // Scroll to show new row if needed
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// ALSO REPLACE the helper functions to return promises properly:

async function loadCountriesForSelect(selectElement) {
  try {
    const snap = await getDocs(collection(window.db, 'locations'));
    const countries = snap.docs.map(d => d.id).sort();
    selectElement.innerHTML = '<option value="">Select Country</option>' + 
      countries.map(c => `<option value="${c}">${c}</option>`).join('');
    return countries;
  } catch (err) {
    console.error('Error loading countries:', err);
    selectElement.innerHTML = '<option value="">Error loading countries</option>';
    return [];
  }
}

async function loadStatesForSelect(country, selectElement, callback = null) {
  if (!country) return [];
  try {
    const snap = await getDocs(collection(window.db, `locations/${country}/states`));
    const states = snap.docs.map(d => d.id).sort();
    selectElement.innerHTML = '<option value="">Select State</option>' + 
      states.map(s => `<option value="${s}">${s}</option>`).join('');
    if (callback) callback();
    return states;
  } catch (err) {
    console.error('Error loading states:', err);
    selectElement.innerHTML = '<option value="">Error loading states</option>';
    return [];
  }
}

async function loadKennelsForSelect(country, state, selectElement, callback = null) {
  if (!country || !state) return [];
  try {
    const snap = await getDocs(collection(window.db, `locations/${country}/states/${state}/kennels`));
    const kennels = snap.docs.map(d => d.id).sort();
    selectElement.innerHTML = '<option value="">Select Kennel</option>' + 
      kennels.map(k => `<option value="${k}">${k}</option>`).join('');
    if (callback) callback();
    return kennels;
  } catch (err) {
    console.error('Error loading kennels:', err);
    selectElement.innerHTML = '<option value="">Error loading kennels</option>';
    return [];
  }
}

// ADD THIS: Helper to update chips display
function updateKennelChips(els) {
  // Optional: Add visual chips above the dropdowns showing selected kennels
  const chips = collaboratingKennels
    .filter(k => k.kennel)
    .map(k => `<span class="kennel-chip">${k.kennel} (${k.state}, ${k.country})</span>`)
    .join('');
  
  // You can display chips in a separate div if desired
}



// Image compression utility to reduce upload time
async function compressImage(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + '.jpg', { 
              type: 'image/jpeg', 
              lastModified: Date.now() 
            }));
          } else {
            reject(new Error('Canvas to Blob failed'));
          }
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ADD THIS: Open cropper modal for event image
function openEventImageCropper(els, imageSrc) {
  // Create modal if it doesn't exist
  if (!eventImageCropperModal) {
    createEventImageCropperModal(els);
  }
  
  els.cropperImage.src = imageSrc;
  eventImageCropperModal.classList.add('active');
  
  // Initialize cropper after image loads
  els.cropperImage.onload = () => {
    initEventImageCropper(els);
  };
}

// ADD THIS: Create cropper modal HTML structure - FREE FORM CROPPER
function createEventImageCropperModal(els) {
  const modal = document.createElement('div');
  modal.id = 'eventImageCropperModal';
  modal.className = 'cropper-modal';
  modal.innerHTML = `
    <div class="cropper-container" style="max-width: 95vw; width: 800px;">
      <div class="cropper-header">
        <h3>Crop Event Image</h3>
        <button id="btnCloseEventCropper" class="close-btn">×</button>
      </div>
      
      <!-- Instructions -->
      <div class="cropper-instructions" style="
        padding: 10px 20px;
        background: #FFF3E0;
        border-bottom: 1px solid #FFE0B2;
        font-size: 13px;
        color: #E65100;
        text-align: center;
      ">
        Drag to move • Resize corners/edges freely • Zoom to adjust
      </div>
      
      <div class="cropper-body" style="height: 500px; background: #333; position: relative;">
        <img id="eventCropperImage" src="" alt="Crop preview" style="max-height: 100%;">
      </div>
      
      <div class="cropper-controls" style="
        padding: 12px 20px;
        background: #f5f5f5;
        border-top: 1px solid #e0e0e0;
        display: flex;
        gap: 20px;
        align-items: center;
      ">
        <label style="display: flex; align-items: center; gap: 8px; flex: 1;">
          <span>Zoom</span>
          <input type="range" id="eventZoomSlider" min="0.1" max="3" step="0.1" value="1" style="flex: 1;">
        </label>
        <button type="button" id="btnResetCrop" style="
          padding: 6px 12px;
          border: 1px solid #ddd;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        ">Reset</button>
      </div>
      
      <div class="cropper-footer" style="
        padding: 16px 20px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <div class="crop-dimensions" id="cropDimensions" style="
          font-size: 13px;
          color: #666;
          font-family: monospace;
        ">
          Width: -- | Height: --
        </div>
        <div style="display: flex; gap: 12px;">
          <button id="btnCancelEventCrop" class="btn-secondary" style="
            padding: 10px 20px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          ">Cancel</button>
          <button id="btnConfirmEventCrop" class="btn-primary" style="
            padding: 10px 24px;
            border: none;
            background: #FF6D00;
            color: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
          ">Crop & Use</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Cache elements
  eventImageCropperModal = modal;
  els.cropperModal = modal;
  els.cropperImage = modal.querySelector('#eventCropperImage');
  els.zoomSlider = modal.querySelector('#eventZoomSlider');
  
  // Event listeners
  modal.querySelector('#btnCloseEventCropper').onclick = () => closeEventImageCropper(els);
  modal.querySelector('#btnCancelEventCrop').onclick = () => closeEventImageCropper(els);
  modal.querySelector('#btnConfirmEventCrop').onclick = () => confirmEventImageCrop(els);
  modal.querySelector('#btnResetCrop').onclick = () => {
    if (eventImageCropper) {
      eventImageCropper.reset();
      eventImageCropper.setCropBoxData({
        left: 0,
        top: 0,
        width: els.cropperImage.naturalWidth,
        height: els.cropperImage.naturalHeight
      });
    }
  };
  
  // Zoom control
  els.zoomSlider.addEventListener('input', (e) => {
    if (eventImageCropper) {
      const ratio = parseFloat(e.target.value);
      eventImageCropper.zoomTo(ratio);
    }
  });
  
  // Close on overlay click
  modal.onclick = (e) => {
    if (e.target === modal) closeEventImageCropper(els);
  };
}

// ADD THIS: Initialize Cropper.js for event image - FREE FORM (NO ASPECT RATIO)
function initEventImageCropper(els) {
  // Destroy existing cropper if any
  if (eventImageCropper) {
    eventImageCropper.destroy();
  }

  eventImageCropper = new Cropper(els.cropperImage, {
    aspectRatio: NaN,     // NO aspect ratio constraint - FREE FORM
    viewMode: 1,          // Restrict crop box to canvas
    dragMode: 'move',
    autoCropArea: 0.8,    // Initial crop area (80%)
    restore: false,
    guides: true,          // Show guides
    center: true,
    highlight: true,
    cropBoxMovable: true,
    cropBoxResizable: true,
    toggleDragModeOnDblclick: false,
    
    // Allow free resizing of crop box
    minCropBoxWidth: 50,   // Minimum width in pixels
    minCropBoxHeight: 50,  // Minimum height in pixels
    
    // No maximum constraints - user can crop any size
    ready: () => {
      els.zoomSlider.value = 1;
      
      // Update dimensions display
      updateCropDimensions();
      
      // Set initial crop box to cover most of the image
      const canvasData = eventImageCropper.getCanvasData();
      const initialCropWidth = canvasData.width * 0.9;
      const initialCropHeight = canvasData.height * 0.9;
      
      eventImageCropper.setCropBoxData({
        left: (canvasData.width - initialCropWidth) / 2,
        top: (canvasData.height - initialCropHeight) / 2,
        width: initialCropWidth,
        height: initialCropHeight
      });
    },
    
    zoom: (event) => {
      const ratio = event.detail.ratio;
      els.zoomSlider.value = ratio;
    },
    
    // Update dimensions on crop move/resize
    crop: () => {
      updateCropDimensions();
    }
  });
}

// ADD THIS: Helper to update dimensions display
function updateCropDimensions() {
  if (!eventImageCropper) return;
  
  const cropData = eventImageCropper.getCropBoxData();
  const width = Math.round(cropData.width);
  const height = Math.round(cropData.height);
  
  const dimensionsDiv = document.getElementById('cropDimensions');
  if (dimensionsDiv) {
    dimensionsDiv.textContent = `Width: ${width}px | Height: ${height}px`;
  }
}

// ADD THIS: Close cropper modal
function closeEventImageCropper(els) {
  if (eventImageCropperModal) {
    eventImageCropperModal.classList.remove('active');
  }
  if (eventImageCropper) {
    eventImageCropper.destroy();
    eventImageCropper = null;
  }
}

// ADD THIS: Confirm crop and process image - USES ACTUAL CROP DIMENSIONS
async function confirmEventImageCrop(els) {
  if (!eventImageCropper) return;

  // Show loading state
  const confirmBtn = eventImageCropperModal.querySelector('#btnConfirmEventCrop');
  const originalText = confirmBtn.textContent;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Processing...';

  try {
    // Get actual crop dimensions
    const cropData = eventImageCropper.getCropBoxData();
    const canvasData = eventImageCropper.getCanvasData();
    
    // Calculate output dimensions (maintain original resolution up to max)
    const maxOutputWidth = 1600;
    const maxOutputHeight = 1600;
    
    let outputWidth = cropData.width * (canvasData.naturalWidth / canvasData.width);
    let outputHeight = cropData.height * (canvasData.naturalHeight / canvasData.height);
    
    // Scale down if exceeds max
    if (outputWidth > maxOutputWidth || outputHeight > maxOutputHeight) {
      const scale = Math.min(maxOutputWidth / outputWidth, maxOutputHeight / outputHeight);
      outputWidth *= scale;
      outputHeight *= scale;
    }
    
    // Ensure minimum dimensions
    outputWidth = Math.max(outputWidth, 400);
    outputHeight = Math.max(outputHeight, 300);

    console.log(`Cropping to: ${Math.round(outputWidth)}x${Math.round(outputHeight)}`);

    // Get cropped canvas with actual dimensions
    const croppedCanvas = eventImageCropper.getCroppedCanvas({
      width: Math.round(outputWidth),
      height: Math.round(outputHeight),
      minWidth: 100,
      minHeight: 100,
      maxWidth: 2000,
      maxHeight: 2000,
      fillColor: '#fff',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    // Convert to blob (JPEG for smaller size)
    const blob = await new Promise((resolve, reject) => {
      croppedCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas to Blob failed'));
        }
      }, 'image/jpeg', 0.92);
    });

    // Create file from blob with dimensions in filename
    const width = croppedCanvas.width;
    const height = croppedCanvas.height;
    selectedImageFile = new File([blob], `event_image_${width}x${height}.jpg`, { 
      type: 'image/jpeg', 
      lastModified: Date.now() 
    });

    console.log(`Final cropped image: ${width}x${height}, ${(selectedImageFile.size/1024).toFixed(0)}KB`);

    // Update preview
    const url = URL.createObjectURL(selectedImageFile);
    els.previewImg.src = url;
    els.previewImg.classList.remove('hidden');
    els.placeholder.classList.add('hidden');

    // Close cropper
    closeEventImageCropper(els);

  } catch (error) {
    console.error('Error processing cropped image:', error);
    alert('Failed to process image: ' + error.message);
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalText;
  }
}

// [EXISTING CODE]

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
  // ADD THIS: Enable collaboration for Tier 1 admins
  els.chkCollaboration.disabled = false;
} else {
  els.country.value = userData?.country || '';
  els.state.value = userData?.state || '';
  els.kennel.value = userData?.kennel || '';
  els.country.disabled = true;
  els.state.disabled = true;
  els.kennel.disabled = true;
  // ADD THIS: Disable collaboration for regular users (they can only create for their kennel)
  els.chkCollaboration.disabled = true;
  els.chkCollaboration.checked = false;
}

      
      // Load users for Signed By dropdown - store hashHandle and designation
      const usersSnap = await getDocs(collection(window.db, 'users'));
      availableHashers = usersSnap.docs.map(d => ({
        hashHandle: d.data().hashHandle,
        designation: d.data().designation || ''
      })).filter(u => u.hashHandle).sort((a, b) => a.hashHandle.localeCompare(b.hashHandle));
      
      // Populate the <select> dropdown with hashers
      populateSignedByDropdown(els.signedBy, availableHashers);
      
      addAccommodationRow(els);
	        // ADD THIS: Setup multi-select UI (hidden by default for single kennel)
      els.signedByMultiWrapper.classList.add('hidden');
     els.signedByMultiInput.required = false;
      
            if (isEditMode) {
        console.log('Calling loadExistingEvent with ID:', editEventId);
        await loadExistingEvent(els, editEventId);
        console.log('loadExistingEvent completed');
      } else {
        // Only add first accommodation row for new events
        addAccommodationRow(els);
      }
      
    } catch (err) {
      console.error('Error initializing app:', err);
      alert('Error loading data. Please try again.');
    }
  });
}

// New function to populate the select dropdown
function populateSignedByDropdown(selectElement, hashers) {
  // Clear existing options
  selectElement.innerHTML = '';
  
  // Add default option
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select a Hasher...';
  selectElement.appendChild(defaultOption);
  
  // Add hasher options
  hashers.forEach(hasher => {
    const option = document.createElement('option');
    option.value = hasher.hashHandle;
    // Display format: "HashHandle (Designation)" or just "HashHandle" if no designation
    option.textContent = hasher.designation 
      ? `${hasher.hashHandle} (${hasher.designation})`
      : hasher.hashHandle;
    selectElement.appendChild(option);
  });
}

// ADD THIS: Setup multi-select signed by for collaboration events
async function setupSignedByMultiSelect(els) {
  try {
    const usersSnap = await getDocs(collection(window.db, "users"));
    const users = usersSnap.docs
      .map(d => {
        const data = d.data();
        return {
          hashHandle: data.hashHandle || data.hashHandleLower,
          designation: data.designation || ''
        };
      })
      .filter(u => u.hashHandle)
      .sort((a, b) => a.hashHandle.localeCompare(b.hashHandle));
    
    const wrapper = els.signedByMultiWrapper;
    const input = els.signedByMultiInput;
    const dropdown = els.signedByDropdown;
    const chipsContainer = els.signedByChipsContainer;
    
    // Populate dropdown
    function populateDropdown(filter = "") {
      const filtered = users.filter(u => 
        u.hashHandle.toLowerCase().includes(filter.toLowerCase()) &&
        !selectedSigners.find(s => s.hashHandle === u.hashHandle)
      );
      dropdown.innerHTML = filtered.map(u => 
        `<div class="hare-dropdown-item" data-handle="${u.hashHandle}" data-designation="${u.designation}">
          ${u.hashHandle} ${u.designation ? `(${u.designation})` : ''}
        </div>`
      ).join("");
    }
    
    // Show all on focus
    input.addEventListener("focus", () => {
      populateDropdown(input.value);
      dropdown.classList.add("active");
    });
    
    // Filter on input
    input.addEventListener("input", () => {
      populateDropdown(input.value);
    });
    
    // Handle selection
    dropdown.addEventListener("click", (e) => {
      if (e.target.classList.contains("hare-dropdown-item")) {
        const handle = e.target.dataset.handle;
        const designation = e.target.dataset.designation;
        
        if (selectedSigners.find(s => s.hashHandle === handle)) {
          alert("Signer already added");
        } else if (selectedSigners.length >= MAX_SIGNERS) {
          alert(`Max ${MAX_SIGNERS} signers allowed`);
        } else {
          selectedSigners.push({ hashHandle: handle, designation });
          addSignerChip(handle, designation, els);
        }
        
        input.value = "";
        dropdown.classList.remove("active");
      }
    });
    
    // Hide on click outside
    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.classList.remove("active");
      }
    });
    
  } catch (err) {
    console.error("Error setting up signed by multi-select:", err);
  }
}

// ADD THIS: Add signer chip
function addSignerChip(hashHandle, designation, els) {
  const chip = document.createElement("div");
  chip.className = "hare-chip";
  chip.innerHTML = `
    <span>${hashHandle} ${designation ? `(${designation})` : ''}</span>
    <button type="button" class="hare-chip-remove" data-handle="${hashHandle}">×</button>
  `;
  
  chip.querySelector(".hare-chip-remove").onclick = () => {
    chip.remove();
    selectedSigners = selectedSigners.filter(s => s.hashHandle !== hashHandle);
  };
  
  els.signedByChipsContainer.appendChild(chip);
}

function setupTier1Listeners(els) {
  els.country.addEventListener('change', async () => {
    const country = els.country.value;
    els.state.value = '';
    els.kennel.value = '';
    
    if (!country) {
      console.log('No country selected, skipping state load');
      return;
    }
    
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

// REPLACE your entire loadExistingEvent function with this fixed version:

async function loadExistingEvent(els, eventId) {
  try {
    const snap = await getDoc(doc(window.db, 'events', eventId));
    if (!snap.exists()) return;
    
    const data = snap.data();
    
    // Basic info
    document.getElementById('etRunTitle').value = data.title || '';
    document.getElementById('etStartDate').value = data.startDate || '';
    document.getElementById('etEndDate').value = data.endDate || '';
    document.getElementById('etRunTime').value = data.time || '';
    els.address.value = data.address || '';
    document.getElementById('actvCurrency').value = data.currency || 'USD';
    document.getElementById('etSponsorship').value = data.sponsorship || '';
    document.getElementById('etWhatToExpect').value = data.whatToExpect || '';
    els.etEventDetails.value = data.eventDetails || '';
    
    // CRITICAL FIX: Handle collaboration mode FIRST before any other UI setup
    const isCollaboration = data.isCollaboration === true || (data.kennels && data.kennels.length > 1);
    
    if (isCollaboration) {
      console.log('Loading collaboration event with kennels:', data.kennels);
      
      // Set checkbox state
      els.chkCollaboration.checked = true;
      
      // IMMEDIATELY hide single kennel fields (don't wait for event)
      const countryGroup = els.country.closest('.input-group');
      const stateGroup = els.state.closest('.input-group');
      const kennelGroup = els.kennel.closest('.input-group');
      
      if (countryGroup) countryGroup.classList.add('hidden');
      if (stateGroup) stateGroup.classList.add('hidden');
      if (kennelGroup) kennelGroup.classList.add('hidden');
      
      // Disable single kennel inputs
      els.country.disabled = true;
      els.state.disabled = true;
      els.kennel.disabled = true;
      els.country.required = false;
      els.state.required = false;
      els.kennel.required = false;
      
      // Show collaboration section
      els.collaborationSection.classList.remove('hidden');
      
      // Clear and load collaborating kennels
      els.kennelChipsContainer.innerHTML = '';
      collaboratingKennels = [];
      
      // Load all collaborating kennels with a slight delay to ensure DOM is ready
      if (data.kennels && data.kennels.length > 0) {
        for (const k of data.kennels) {
          let kennelData;
          if (typeof k === 'string') {
            kennelData = { 
              country: data.country || '', 
              state: data.state || '', 
              kennel: k 
            };
          } else if (typeof k === 'object' && k !== null) {
            kennelData = {
              country: k.country || data.country || '',
              state: k.state || data.state || '',
              kennel: k.kennel || ''
            };
          } else {
            continue;
          }
          
          if (kennelData.kennel) {
            // Add row with existing data - it will handle its own async loading
            addCollaborationKennelRow(els, kennelData);
          }
        }
      }
      
      // Setup multi-select signed by for collaboration
      els.signedBy.classList.add('hidden');
      els.signedByMultiWrapper.classList.remove('hidden');
      els.signedBy.required = false;
      if (els.signedByMultiInput) els.signedByMultiInput.required = false;
      
      // Setup multi-select if not already done
      if (!els.signedByMultiWrapper.dataset.initialized) {
        await setupSignedByMultiSelect(els);
        els.signedByMultiWrapper.dataset.initialized = 'true';
      }
      
      // Restore selected signers for collaboration mode
      selectedSigners = [];
      els.signedByChipsContainer.innerHTML = '';
      
      if (Array.isArray(data.signedBy)) {
        selectedSigners = data.signedBy;
        selectedSigners.forEach(signer => {
          if (signer && signer.hashHandle) {
            addSignerChip(signer.hashHandle, signer.designation, els);
          }
        });
      }
      
    } else {
      // Single kennel mode
      els.chkCollaboration.checked = false;
      els.collaborationSection.classList.add('hidden');
      
      // Ensure single kennel fields are visible
      const countryGroup = els.country.closest('.input-group');
      const stateGroup = els.state.closest('.input-group');
      const kennelGroup = els.kennel.closest('.input-group');
      
      if (countryGroup) countryGroup.classList.remove('hidden');
      if (stateGroup) stateGroup.classList.remove('hidden');
      if (kennelGroup) kennelGroup.classList.remove('hidden');
      
      // Enable/disable based on tier
      els.country.disabled = !isTier1Admin;
      els.state.disabled = !isTier1Admin;
      els.kennel.disabled = !isTier1Admin;
      els.country.required = true;
      els.state.required = true;
      els.kennel.required = true;
      
      // Set values for single kennel
      els.country.value = data.country || '';
      els.state.value = data.state || '';
      els.kennel.value = data.kennel || '';
      
      // Load state and kennel options if Tier 1 admin
      if (isTier1Admin && data.country) {
        // Load states for this country
        try {
          const statesSnap = await getDocs(collection(window.db, `locations/${data.country}/states`));
          const states = statesSnap.docs.map(d => d.id).sort();
          document.getElementById('stateList').innerHTML = states.map(s => `<option value="${s}">`).join('');
        } catch (err) {
          console.error('Error loading states:', err);
        }
        
        if (data.state) {
          try {
            const kennelsSnap = await getDocs(collection(window.db, `locations/${data.country}/states/${data.state}/kennels`));
            const kennels = kennelsSnap.docs.map(d => d.id).sort();
            document.getElementById('kennelList').innerHTML = kennels.map(k => `<option value="${k}">`).join('');
          } catch (err) {
            console.error('Error loading kennels:', err);
          }
        }
      }
      
      // Single select signed by
      els.signedBy.classList.remove('hidden');
      els.signedByMultiWrapper.classList.add('hidden');
      els.signedBy.required = true;
      if (els.signedByMultiInput) els.signedByMultiInput.required = false;
      
      // Load signedBy for single kennel
      let hashHandleToSelect = '';
      if (data.signedBy && typeof data.signedBy === 'object' && !Array.isArray(data.signedBy)) {
        hashHandleToSelect = data.signedBy.hashHandle || '';
      } else if (typeof data.signedBy === 'string') {
        hashHandleToSelect = data.signedBy;
      }
      
      if (hashHandleToSelect) {
        const hasherExists = availableHashers.some(h => h.hashHandle === hashHandleToSelect);
        if (hasherExists) {
          els.signedBy.value = hashHandleToSelect;
        } else {
          const option = document.createElement('option');
          option.value = hashHandleToSelect;
          option.textContent = `${hashHandleToSelect} (Unknown)`;
          els.signedBy.appendChild(option);
          els.signedBy.value = hashHandleToSelect;
        }
      }
    }
    
    // Load pricing structure
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
      addAccommodationRow(els);
    }
    
    // Load account details
    if (data.accountDetails) {
      accountDetails = {
        useSameAccount: data.accountDetails.useSameAccount ?? true,
        registration: data.accountDetails.registration || { accNo: '', accName: '', bank: '' },
        sponsorship: data.accountDetails.sponsorship || { accNo: '', accName: '', bank: '' },
        accommodation: data.accountDetails.accommodation || { accNo: '', accName: '', bank: '' }
      };
      accountDetailsSaved = true;
      els.accountDetailsSummary.classList.remove('hidden');
    } else if (data.accNo) {
      // Legacy data loading
      accountDetails = {
        useSameAccount: true,
        registration: { accNo: data.accNo || '', accName: data.accName || '', bank: data.bank || '' },
        sponsorship: { accNo: data.sponsorshipAccNo || data.accNo || '', accName: data.sponsorshipAccName || data.accName || '', bank: data.sponsorshipBank || data.bank || '' },
        accommodation: { accNo: data.accommodationAccNo || data.accNo || '', accName: data.accommodationAccName || data.accName || '', bank: data.accommodationBank || data.bank || '' }
      };
      accountDetailsSaved = true;
      els.accountDetailsSummary.classList.remove('hidden');
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
    alert('Error loading event data. Please try again.');
  }
}

async function saveEvent(els) {
  els.btnSave.disabled = true;
  els.progress.classList.remove('hidden');
  
  // Progress tracking
  let currentStep = 1;
  const updateProgress = (message) => {
    els.progress.textContent = `Step ${currentStep}/4: ${message}...`;
    currentStep++;
    console.log(`Save progress: ${message}`);
  };
  
  try {
    // VALIDATION: Check compulsory fields
    updateProgress('Validating form');
    
    // 1. Event Image - Check if new image selected or existing image present
    const hasExistingImage = els.previewImg.src && !els.previewImg.classList.contains('hidden') && els.previewImg.src !== '';
    const hasNewImage = !!selectedImageFile;
    
    if (!hasExistingImage && !hasNewImage) {
      throw new Error('Please select an event image');
    }
    
    // 2. Location Address - Must have address text and coordinates
    if (!els.address.value.trim()) {
      throw new Error('Please enter a location address');
    }
    if (selectedLat == null || selectedLng == null) {
      throw new Error('Please select a location on the map or use current location');
    }
    
    // 3. Account Details - Must be saved
    if (!accountDetailsSaved) {
      throw new Error('Please add account details before saving');
    }
    
    // Validate account details have actual values
    if (!accountDetails.registration.accNo || !accountDetails.registration.accName || !accountDetails.registration.bank) {
      throw new Error('Account details are incomplete. Please re-enter account details');
    }
    
 // REPLACE the "4. Signed By" validation section in saveEvent with this:

// 4. Signed By - Handle both single and multi-select modes
let signedByData;

if (els.chkCollaboration.checked) {
  // Collaboration mode: multi-select required
  if (selectedSigners.length === 0) {
    throw new Error('Please select at least one signer for this collaboration event');
  }
  signedByData = selectedSigners; // Array of {hashHandle, designation}
} else {
  // Single kennel mode: dropdown required
  const signedByValue = els.signedBy.value;
  if (!signedByValue) {
    throw new Error('Please select who signed this event');
  }
  
  // Verify the signed by value exists in our users list and get designation
  const matchedHasher = availableHashers.find(u => u.hashHandle === signedByValue);
  if (!matchedHasher) {
    throw new Error('Please select a valid hasher from the list for "Signed By"');
  }
  signedByData = { hashHandle: matchedHasher.hashHandle, designation: matchedHasher.designation };
}
    
    // 5. Fetch kennel logo from kennel document (in parallel with image prep) - ONLY for single kennel
let kennelLogoUrl = null;
if (!els.chkCollaboration.checked) {
  updateProgress('Fetching kennel information');
  try {
    const kennelRef = doc(window.db, 'locations', els.country.value, 'states', els.state.value, 'kennels', els.kennel.value);
    const kennelSnap = await getDoc(kennelRef);
    if (kennelSnap.exists()) {
      kennelLogoUrl = kennelSnap.data().logoUrl || null;
      console.log('Kennel logo fetched:', kennelLogoUrl);
    }
  } catch (err) {
    console.error('Error fetching kennel logo:', err);
    // Continue without logo - not a fatal error
  }
}
    
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
      }
    };
    
// ADD THIS: Build kennel data based on collaboration mode
let kennelData = {};
if (els.chkCollaboration.checked) {
  // Validate at least one kennel selected
  // CLEAN the objects - remove _elements property that contains HTML references
  const validKennels = collaboratingKennels
    .filter(k => k.kennel && k.country && k.state)
    .map(k => ({
      country: k.country,
      state: k.state,
      kennel: k.kennel
    }));
    
  if (validKennels.length === 0) {
    throw new Error('Please select at least one kennel for collaboration');
  }
  
  kennelData = {
    isCollaboration: true,
    kennels: validKennels, // Array of {country, state, kennel} - clean, no HTML elements
    // Keep first kennel as primary for backward compatibility if needed
    country: validKennels[0].country,
    state: validKennels[0].state,
    kennel: validKennels[0].kennel
  };
} else {
  // Single kennel mode
  kennelData = {
    isCollaboration: false,
    kennels: [{ country: els.country.value, state: els.state.value, kennel: els.kennel.value }],
    country: els.country.value,
    state: els.state.value,
    kennel: els.kennel.value
  };
}

const formData = {
  title: document.getElementById('etRunTitle').value,
  ...kennelData, // Spread the kennel data
      startDate: document.getElementById('etStartDate').value,
      endDate: document.getElementById('etEndDate').value,
      time: document.getElementById('etRunTime').value,
      address: els.address.value,
      lat: selectedLat,
      lng: selectedLng,
      pricing: pricing,
      accountDetails: accountDetails,
      sponsorship: document.getElementById('etSponsorship').value,
      whatToExpect: document.getElementById('etWhatToExpect').value,
      eventDetails: els.etEventDetails.value, // ADD THIS: Event details
      // Store signedBy - single object or array based on collaboration
     
	       // Store signedBy - single object or array based on collaboration
      totalRegistrations: 0,
      signedBy: signedByData, // Either {hashHandle, designation} or [{hashHandle, designation}, ...]
      createdBy: window.auth.currentUser?.uid || '',
      createdAt: Timestamp.now(),
      earlyBirdRegistrations: 0,
      totalRegistrations: 0,
      kennelLogoUrl: kennelLogoUrl // Kennel logo for fast display on events list
    };
    
    // Upload image if selected (with progress tracking)
    if (selectedImageFile) {
      updateProgress(`Uploading image (${(selectedImageFile.size/1024).toFixed(0)}KB)`);
      
      const storageRef = ref(window.storage, `events/${Date.now()}_${selectedImageFile.name}`);
      
      // Use resumable upload with progress tracking
      const uploadTask = uploadBytesResumable(storageRef, selectedImageFile);
      
      // Track upload progress
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progressPercent = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          els.progress.textContent = `Uploading: ${Math.round(progressPercent)}%`;
        },
        (error) => {
          throw new Error('Image upload failed: ' + error.message);
        }
      );
      
      // Wait for upload to complete
      await uploadTask;
      formData.imageUrl = await getDownloadURL(uploadTask.snapshot.ref);
      console.log('Image uploaded successfully');
      
    } else if (hasExistingImage && isEditMode) {
      // Keep existing image URL if editing and no new image uploaded
      // The imageUrl will be preserved in Firestore when using merge
      console.log('Keeping existing image');
    }
    
    // Save to Firestore
    updateProgress('Saving to database');
    
    if (isEditMode) {
      await setDoc(doc(window.db, 'events', editEventId), formData, { merge: true });
      console.log('Event updated:', editEventId);
    } else {
		console.log('About to save. signedByData:', JSON.stringify(signedByData, null, 2));
console.log('FormData signedBy:', JSON.stringify(formData.signedBy, null, 2));
      const docRef = await addDoc(collection(window.db, 'events'), formData);
      console.log('Event created:', docRef.id);
    }
    
    els.progress.textContent = 'Complete!';
    alert('Event saved successfully!');
    window.location.href = 'events.html';
    
  } catch (err) {
    console.error('Save error:', err);
    alert('Error saving event: ' + err.message);
    els.btnSave.disabled = false;
    els.progress.classList.add('hidden');
    els.progress.textContent = '';
    currentStep = 1;
  }
} // <-- This closes the function