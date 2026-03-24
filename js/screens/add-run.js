import { collection, doc, getDoc, getDocs, setDoc, addDoc, Timestamp, query, where, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// DEBUG: Check URL parameters
console.log("URL:", window.location.href);
console.log("Search params:", window.location.search);
const urlParams = new URLSearchParams(window.location.search);

// FIXED: Changed from "edit" to "editRunId" to match Kotlin
const editRunId = urlParams.get("editRunId") || "";
console.log("editRunId:", editRunId);

// FIXED: Proper boolean check
const isEditMode = editRunId !== "";
console.log("isEditMode:", isEditMode);

// Global variables
let selectedImageFile = null;
let selectedLat = null;
let selectedLng = null;
let latLngFromGPS = false;
let isTier1Admin = false;
let map = null;
let marker = null;
let placesAutocomplete = null;
const selectedHares = [];
const MAX_HARES = 5;
let lastSavedKey = "";

// Global map elements reference
window.mapEls = null;

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  
  // Get elements
  const els = {
    country: document.getElementById("actvCountry"),
    state: document.getElementById("actvState"),
    kennel: document.getElementById("actvKennel"),
    runDay: document.getElementById("actvRunDay"),
    fileInput: document.getElementById("fileInput"),
    previewImg: document.getElementById("previewImg"),
    placeholder: document.querySelector(".image-preview .placeholder"),
    btnSelectImage: document.getElementById("btnSelectImage"),
    btnSave: document.getElementById("btnSaveRun"),
    progress: document.getElementById("progressSave"),
    address: document.getElementById("actvAddress"),
    btnSearchLocation: document.getElementById("btnSearchLocation"),
    btnSaveLocation: document.getElementById("btnSaveLocation"),
    btnUseCurrentLocation: document.getElementById("btnUseCurrentLocation"),
    mapContainer: document.getElementById("map"),
    etRunTitle: document.getElementById("etRunTitle"),
    etRunNumber: document.getElementById("etRunNumber"),
    etRunDate: document.getElementById("etRunDate"),
    etRunTime: document.getElementById("etRunTime"),
    etRegoFee: document.getElementById("etRegoFee"),
    spinnerTrailType: document.getElementById("spinnerTrailType"),
    etAccNo: document.getElementById("etAccNo"),
    etAccName: document.getElementById("etAccName"),
    etBank: document.getElementById("etBank"),
    chipGroupHares: document.getElementById("chipGroupHares"),
    etHareInput: document.getElementById("etHareInput"),
    btnEditRunNumber: document.getElementById("btnEditRunNumber"),
    runNumberDialog: document.getElementById("runNumberDialog"),
    dlgRunNumber: document.getElementById("dlgRunNumber"),
    btnCloseRunNumberDialog: document.getElementById("btnCloseRunNumberDialog"),
    btnSaveRunNumber: document.getElementById("btnSaveRunNumber")
  };
  
  // Store globally for initMap callback
  window.mapEls = els;
  
  // Setup event listeners
  setupEventListeners(els);
  
  // Load hares immediately for autocomplete (before auth check)
  setupHareMultiSelect(els);
  
  // Initialize app
  initApp(els);
  
  // Check if Google Maps already loaded
  if (typeof google !== "undefined" && google.maps) {
    console.log("Google Maps already loaded, initializing now...");
    initializeMap(els);
  }
});

window.initializeMap = function(els) {
  console.log("Initializing map...");
  
  if (!els || !els.mapContainer) {
    console.error("Map container not found!");
    return;
  }
  
  if (map) {
    console.log("Map already initialized");
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
    
    // Map click - NOT GPS origin
    map.addListener("click", (e) => {
      latLngFromGPS = false;
      marker.setPosition(e.latLng);
      selectedLat = e.latLng.lat();
      selectedLng = e.latLng.lng();
      reverseGeocode(e.latLng, els);
      toggleSaveLocation(els);
      console.log("Map clicked:", selectedLat, selectedLng);
    });
    
    // Marker drag end - NOT GPS origin
    marker.addListener("dragend", (e) => {
      latLngFromGPS = false;
      selectedLat = e.latLng.lat();
      selectedLng = e.latLng.lng();
      reverseGeocode(e.latLng, els);
      toggleSaveLocation(els);
      console.log("Marker dragged:", selectedLat, selectedLng);
    });
    
    setupPlacesAutocomplete(els);
    
    console.log("Map initialized successfully");
    
  } catch (err) {
    console.error("Map initialization error:", err);
    els.mapContainer.innerHTML = "<p style=\"padding:20px;text-align:center;color:#f44336;\">Error loading map. Please check API key.</p>";
  }
};

async function loadSavedPlacesForAutocomplete(els) {
  try {
    onSnapshot(
      query(collection(window.db, "saved_places"), orderBy("name")),
      (snap) => {
        const savedPlaces = snap.docs.map(d => d.data().name);
        
        const datalist = document.getElementById("savedPlacesList");
        if (datalist) {
          datalist.innerHTML = savedPlaces.map(name => 
            `<option value="${name}">`
          ).join("");
        }
      }
    );
  } catch (err) {
    console.error("Error loading saved places:", err);
  }
}

function setupPlacesAutocomplete(els) {
  if (!google.maps.places) {
    console.log("Places library not loaded");
    return;
  }
  
  console.log("Setting up Places autocomplete...");
  
  try {
    placesAutocomplete = new google.maps.places.Autocomplete(els.address, {
      types: ["geocode", "establishment"]
    });
    
    placesAutocomplete.bindTo("bounds", map);
    
    placesAutocomplete.addListener("place_changed", async () => {
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
        console.log("Google Place selected:", place.name, selectedLat, selectedLng);
        return;
      }
      
      // Check saved places
      const name = els.address.value.trim();
      if (name) {
        try {
          const docRef = doc(window.db, "saved_places", name.toLowerCase().replace(/\\s+/g, "-"));
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
            console.log("Saved place found:", name, selectedLat, selectedLng);
          }
        } catch (err) {
          console.error("Error checking saved place:", err);
        }
      }
    });
    
    loadSavedPlacesForAutocomplete(els);
    
  } catch (err) {
    console.error("Error setting up Places autocomplete:", err);
  }
}

function reverseGeocode(latLng, els) {
  if (!google.maps.Geocoder) return;
  
  if (!map || !marker) {
    console.log("Map not ready for reverse geocoding");
    return;
  }
  
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: latLng }, (results, status) => {
    if (status === "OK" && results[0]) {
      els.address.value = results[0].formatted_address;
      console.log("Address found:", results[0].formatted_address);
    } else {
      console.log("Geocode failed:", status);
    }
  });
}

function toggleSaveLocation(els) {
  console.log("DEBUG toggleSaveLocation called:");
  console.log("  latLngFromGPS:", latLngFromGPS);
  console.log("  selectedLat:", selectedLat);
  console.log("  selectedLng:", selectedLng);
  
  if (selectedLat != null && selectedLng != null && latLngFromGPS) {
    console.log("  -> SHOWING button");
    els.btnSaveLocation.classList.remove("hidden");
  } else {
    console.log("  -> HIDING button");
    els.btnSaveLocation.classList.add("hidden");
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
    els.previewImg.classList.remove("hidden");
    els.placeholder.classList.add("hidden");
  };
  
  // Run Number Edit Dialog
  els.btnEditRunNumber.onclick = () => {
    els.dlgRunNumber.value = els.etRunNumber.value || "";
    els.runNumberDialog.classList.remove("hidden");
    els.runNumberDialog.style.display = "flex";
  };
  
  els.btnCloseRunNumberDialog.onclick = () => {
    els.runNumberDialog.classList.add("hidden");
    els.runNumberDialog.style.display = "none";
  };
  
  els.btnSaveRunNumber.onclick = () => {
    const num = parseInt(els.dlgRunNumber.value);
    if (num && num > 0) {
      els.etRunNumber.value = num.toString();
    }
    els.runNumberDialog.classList.add("hidden");
    els.runNumberDialog.style.display = "none";
  };
  
  // Date picker - auto set Run Day
  els.etRunDate.onchange = () => {
    updateRunDayFromDate(els);
  };
  
  // Search location by address
  els.btnSearchLocation.onclick = () => {
    latLngFromGPS = false;
    const address = els.address.value.trim();
    if (!address) {
      alert("Please enter an address");
      return;
    }
    
    if (!google.maps.Geocoder) {
      alert("Map not ready yet");
      return;
    }
    
    if (!map) {
      alert("Map is still loading. Please wait a moment and try again.");
      return;
    }
    
    console.log("Searching for:", address);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: address }, (results, status) => {
      if (status === "OK" && results[0]) {
        const loc = results[0].geometry.location;
        map.setCenter(loc);
        map.setZoom(15);
        marker.setPosition(loc);
        selectedLat = loc.lat();
        selectedLng = loc.lng();
        toggleSaveLocation(els);
        console.log("Location found:", loc.lat(), loc.lng());
      } else {
        alert("Location not found: " + status);
      }
    });
  };
  
  // Use current location
  els.btnUseCurrentLocation.onclick = () => {
    console.log("Requesting current location...");
    
    if (!navigator.geolocation) {
      alert("Geolocation not supported by your browser");
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log("Got position:", position.coords);
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
        console.error("Geolocation error:", error);
        alert("Could not get location: " + error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };
  
  // Save location
  els.btnSaveLocation.onclick = async () => {
    if (!latLngFromGPS) {
      alert("Only GPS locations can be saved");
      return;
    }
    
    const name = els.address.value.trim();
    if (!name || selectedLat == null || selectedLng == null) {
      alert("Address or location missing");
      return;
    }
    
    const key = name.toLowerCase().replace(/\\s+/g, "-");
    if (key === lastSavedKey) return;
    
    try {
      const existing = await getDoc(doc(window.db, "saved_places", key));
      if (existing.exists()) {
        alert("Already saved");
        return;
      }
      
      const q = query(
        collection(window.db, "saved_places"),
        where("lat", "==", selectedLat),
        where("lng", "==", selectedLng),
        limit(1)
      );
      const dupes = await getDocs(q);
      if (!dupes.empty) {
        alert("Same coordinates exist");
        return;
      }
      
      await setDoc(doc(window.db, "saved_places", key), {
        name: name,
        lat: selectedLat,
        lng: selectedLng,
        createdAt: Timestamp.now()
      });
      
      lastSavedKey = key;
      alert("Location saved to book");
      
    } catch (err) {
      console.error("Save location error:", err);
      alert("Error saving location");
    }
  };
  
  // Form submit
  document.getElementById("runForm").onsubmit = async (e) => {
    e.preventDefault();
    await saveRun(els);
  };
}

function updateRunDayFromDate(els) {
  const dateStr = els.etRunDate.value;
  if (!dateStr) return;
  
  try {
    const date = new Date(dateStr);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayName = days[date.getDay()];
    els.runDay.value = dayName;
    console.log("Auto-set run day to:", dayName);
  } catch (err) {
    console.error("Error setting run day:", err);
  }
}

async function setupHareMultiSelect(els) {
  try {
    const usersSnap = await getDocs(collection(window.db, "users"));
    const users = usersSnap.docs
      .map(d => d.data().hashHandle || d.data().hashHandleLower)
      .filter(u => u)
      .sort();
    
    // Create wrapper and dropdown
    const wrapper = document.createElement("div");
    wrapper.className = "hare-autocomplete-wrapper";
    els.etHareInput.parentNode.insertBefore(wrapper, els.etHareInput);
    wrapper.appendChild(els.etHareInput);
    
    const dropdown = document.createElement("div");
    dropdown.className = "hare-dropdown";
    wrapper.appendChild(dropdown);
    
    // Populate dropdown
    function populateDropdown(filter = "") {
      const filtered = users.filter(u => 
        u.toLowerCase().includes(filter.toLowerCase())
      );
      dropdown.innerHTML = filtered.map(u => 
        `<div class="hare-dropdown-item" data-value="${u}">${u}</div>`
      ).join("");
    }
    
    // Show all on focus
    els.etHareInput.addEventListener("focus", () => {
      populateDropdown(els.etHareInput.value);
      dropdown.classList.add("active");
    });
    
    // Filter on input
    els.etHareInput.addEventListener("input", () => {
      populateDropdown(els.etHareInput.value);
    });
    
    // Handle selection
    dropdown.addEventListener("click", (e) => {
      if (e.target.classList.contains("hare-dropdown-item")) {
        const choice = e.target.dataset.value;
        
        if (selectedHares.includes(choice)) {
          alert("Hare already added");
        } else if (selectedHares.length >= MAX_HARES) {
          alert(`Max ${MAX_HARES} hares allowed`);
        } else {
          selectedHares.push(choice);
          addHareChip(choice, els);
        }
        
        els.etHareInput.value = "";
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
    console.error("Error:", err);
  }
}

function addHareChip(text, els) {
  const chip = document.createElement("div");
  chip.className = "chip";
  chip.innerHTML = `
    <span>${text}</span>
    <button type="button" class="chip-close" aria-label="Remove">&times;</button>
  `;
  
  chip.querySelector(".chip-close").onclick = () => {
    const idx = selectedHares.indexOf(text);
    if (idx > -1) selectedHares.splice(idx, 1);
    chip.remove();
  };
  
  els.chipGroupHares.appendChild(chip);
}

async function initApp(els) {
  onAuthStateChanged(window.auth, async (user) => {
    if (!user) {
      console.log("No user logged in, redirecting...");
      window.location.href = "login.html";
      return;
    }
    
    console.log("Current user:", user.uid);
    console.log("initApp - isEditMode:", isEditMode, "editRunId:", editRunId);
    
    try {
      const userDoc = await getDoc(doc(window.db, "users", user.uid));
      const userData = userDoc.data();
      
      isTier1Admin = userData?.role === "Tier 1";
      
      if (isTier1Admin) {
        els.country.disabled = false;
        els.state.disabled = false;
        els.kennel.disabled = false;
        await loadCountries();
        setupTier1Listeners(els);
      } else {
        els.country.value = userData?.country || "";
        els.state.value = userData?.state || "";
        els.kennel.value = userData?.kennel || "";
        els.country.disabled = true;
        els.state.disabled = true;
        els.kennel.disabled = true;
        
        // Load next run number and last rego fee for non-tier1
        if (!isEditMode) {
          await loadNextRunNumber(els);
          await loadLastRegoFee(els);
        }
      }
      
      // FIXED: Load existing run if in edit mode
      if (isEditMode) {
        console.log("Calling loadExistingRun with ID:", editRunId);
        await loadExistingRun(els, editRunId);
        console.log("loadExistingRun completed");
      }
      
    } catch (err) {
      console.error("Error initializing app:", err);
      alert("Error loading data. Please try again.");
    }
  });
}

function setupTier1Listeners(els) {
  els.country.addEventListener("change", async () => {
    const country = els.country.value;
    els.state.value = "";
    els.kennel.value = "";
    
    if (!country) return;
    
    try {
      const snap = await getDocs(collection(window.db, `locations/${country}/states`));
      const states = snap.docs.map(d => d.id).sort();
      document.getElementById("stateList").innerHTML = states.map(s => `<option value="${s}">`).join("");
    } catch (err) {
      console.error("Error loading states:", err);
    }
  });
  
  els.state.addEventListener("change", async () => {
    const country = els.country.value;
    const state = els.state.value;
    els.kennel.value = "";
    
    if (!country || !state) return;
    
    try {
      const snap = await getDocs(collection(window.db, `locations/${country}/states/${state}/kennels`));
      const kennels = snap.docs.map(d => d.id).sort();
      document.getElementById("kennelList").innerHTML = kennels.map(k => `<option value="${k}">`).join("");
    } catch (err) {
      console.error("Error loading kennels:", err);
    }
  });
}

async function loadCountries() {
  try {
    const snap = await getDocs(collection(window.db, "locations"));
    const countries = snap.docs.map(d => d.id).sort();
    document.getElementById("countryList").innerHTML = countries.map(c => `<option value="${c}">`).join("");
  } catch (err) {
    console.error("Error loading countries:", err);
  }
}

async function loadNextRunNumber(els) {
  const kennel = els.kennel.value;
  if (!kennel) return;
  
  try {
    const q = query(
      collection(window.db, "runs"),
      where("kennel", "==", kennel),
      orderBy("runDateTime", "desc"),
      limit(1)
    );
    const snap = await getDocs(q);
    const last = snap.docs[0]?.data()?.runNumber || 0;
    els.etRunNumber.value = (last + 1).toString();
  } catch (err) {
    console.error("Error loading next run number:", err);
    els.etRunNumber.value = "1";
  }
}

async function loadLastRegoFee(els) {
  const kennel = els.kennel.value;
  if (!kennel) return;
  
  try {
    const q = query(
      collection(window.db, "runs"),
      where("kennel", "==", kennel),
      orderBy("runDateTime", "desc"),
      limit(1)
    );
    const snap = await getDocs(q);
    const fee = snap.docs[0]?.data()?.regoFee;
    if (fee) {
      els.etRegoFee.value = fee.toFixed(2);
    }
  } catch (err) {
    console.error("Error loading last rego fee:", err);
  }
}

// FIXED: Enhanced loadExistingRun with better error handling and logging
async function loadExistingRun(els, runId) {
  try {
    console.log("Loading existing run template:", runId);
    const snap = await getDoc(doc(window.db, "runs", runId));
    
    if (!snap.exists()) {
      console.error("Run template not found:", runId);
      alert("Run not found. It may have been deleted.");
      return;
    }
    
    const data = snap.data();
    console.log("Loaded template data:", data);
    
    // Basic info
    els.etRunTitle.value = data.title || "";
    els.etRunNumber.value = data.runNumber?.toString() || "";
    els.country.value = data.country || "";
    els.state.value = data.state || "";
    els.kennel.value = data.kennel || "";
    els.etRunDate.value = data.date || "";
    els.etRunTime.value = data.time || "";
    els.etRegoFee.value = data.regoFee?.toString() || "";
    els.spinnerTrailType.value = data.trailType || "";
    els.runDay.value = data.runDay || "Thursday";
    els.address.value = data.address || "";
    els.etAccNo.value = data.accNo || "";
    els.etAccName.value = data.accName || "";
    els.etBank.value = data.bank || "";
    
    // Update run day from date if date exists
    if (data.date) {
      updateRunDayFromDate(els);
    }
    
    // Cadence radio
    const cadenceValue = data.cadence || "weekly";
    const radio = document.querySelector(`input[name="cadence"][value="${cadenceValue}"]`);
    if (radio) radio.checked = true;
    
    // Image
    if (data.imageUrl) {
      els.previewImg.src = data.imageUrl;
      els.previewImg.classList.remove("hidden");
      els.placeholder.classList.add("hidden");
    }
    
    // Map location - wait for map to be ready
    if (data.lat && data.lng) {
      selectedLat = data.lat;
      selectedLng = data.lng;
      latLngFromGPS = false;
      
      // If map is ready, set position
      if (map && marker) {
        const loc = { lat: data.lat, lng: data.lng };
        map.setCenter(loc);
        map.setZoom(15);
        marker.setPosition(loc);
        console.log("Map position set to:", loc);
      } else {
        console.log("Map not ready yet, position will be set when map initializes");
        // Store for later when map initializes
        window.pendingMapLocation = { lat: data.lat, lng: data.lng };
      }
    }
    
    // Hares
    selectedHares.length = 0;
    els.chipGroupHares.innerHTML = "";
    if (data.hare) {
      const hares = data.hare.split(",").map(h => h.trim()).filter(h => h);
      hares.forEach(hare => {
        selectedHares.push(hare);
        addHareChip(hare, els);
      });
    }
    
    console.log("Finished loading run template");
    
  } catch (err) {
    console.error("Error loading existing run:", err);
    alert("Error loading run details. Please try again.");
  }
}

async function saveRun(els) {
  // Validation
  const title = els.etRunTitle.value.trim();
  const runNumber = parseInt(els.etRunNumber.value) || 0;
  const date = els.etRunDate.value;
  const time = els.etRunTime.value;
  const regoFee = parseFloat(els.etRegoFee.value) || 0;
  const trailType = els.spinnerTrailType.value.trim();
  const hare = selectedHares.join(", ");
  const address = els.address.value.trim();
  const country = els.country.value.trim();
  const state = els.state.value.trim();
  const kennel = els.kennel.value.trim();
  const runDay = els.runDay.value.trim();
  const cadence = document.querySelector('input[name="cadence"]:checked')?.value || "weekly";
  const accNo = els.etAccNo.value.trim();
  const accName = els.etAccName.value.trim();
  const bank = els.etBank.value.trim();
  
  const missing = [];
  if (!title) missing.push("title");
  if (runNumber <= 0) missing.push("run number");
  if (!date) missing.push("date");
  if (!time) missing.push("time");
  if (regoFee <= 0) missing.push("rego fee");
  if (!trailType) missing.push("trail type");
  if (!hare) missing.push("hare");
  if (!address) missing.push("address");
  if (!country) missing.push("country");
  if (!state) missing.push("state");
  if (!kennel) missing.push("kennel");
  if (!runDay) missing.push("run day");
  
  if (missing.length > 0) {
    alert("Please fill: " + missing.join(", "));
    return;
  }
  
  // Image check
  const hasExistingImage = els.previewImg.src && !els.previewImg.classList.contains("hidden") && els.previewImg.src !== "";
  const hasNewImage = !!selectedImageFile;
  
  if (!hasExistingImage && !hasNewImage) {
    alert("Please select a run image");
    return;
  }
  
  // Lat/Lng check
  if (selectedLat == null || selectedLng == null || (selectedLat === 0 && selectedLng === 0)) {
    alert("Please set a valid location");
    return;
  }
  
  els.btnSave.disabled = true;
  els.progress.classList.remove("hidden");
  els.btnSave.textContent = "Saving...";
  
  try {
    // Build run timestamp
    const runTs = date ? Timestamp.fromDate(new Date(date)) : Timestamp.now();
    
    const formData = {
      title: title,
      runNumber: runNumber,
      date: date,
      time: time,
      regoFee: regoFee,
      trailType: trailType,
      hare: hare,
      address: address,
      country: country,
      state: state,
      kennel: kennel,
      runDay: runDay,
      cadence: cadence,
      lat: selectedLat,
      lng: selectedLng,
      runDateTime: runTs,
      createdBy: window.auth.currentUser?.uid || "",
      createdAt: Timestamp.now(),
      accNo: accNo,
      accName: accName,
      bank: bank
    };
    
    // FIXED: Use editRunId directly when in edit mode
    let runRef;
    
    if (isEditMode && editRunId) {
      // Update existing run template
      runRef = doc(window.db, "runs", editRunId);
      console.log("Updating existing run:", editRunId);
    } else {
      // Check for existing run in this kennel
      const existingQuery = query(
        collection(window.db, "runs"),
        where("kennel", "==", kennel),
        limit(1)
      );
      const existingSnap = await getDocs(existingQuery);
      
      if (!existingSnap.empty) {
        runRef = doc(window.db, "runs", existingSnap.docs[0].id);
        console.log("Updating existing kennel run:", runRef.id);
      } else {
        runRef = doc(collection(window.db, "runs"));
        console.log("Creating new run:", runRef.id);
      }
    }
    
    // Upload image if selected
    if (selectedImageFile) {
      const storageRef = ref(window.storage, `runs/${Date.now()}_${selectedImageFile.name}`);
      await uploadBytes(storageRef, selectedImageFile);
      formData.imageUrl = await getDownloadURL(storageRef);
    }
    
    // Save to Firestore
    await setDoc(runRef, formData, { merge: true });
    console.log("Run saved to:", runRef.id);
    
    // Save to history
    await saveToHistory(runRef.id, formData);
    
    alert("Run saved successfully!");
    window.location.href = "runs.html";
    
  } catch (err) {
    console.error("Save error:", err);
    alert("Error saving run: " + err.message);
    els.btnSave.disabled = false;
    els.progress.classList.add("hidden");
    els.btnSave.textContent = "Save Run";
  }
}

async function existingHistoryId(templateId, date) {
  try {
    const q = query(
      collection(window.db, "runsHistory"),
      where("templateId", "==", templateId),
      where("date", "==", date),
      limit(1)
    );
    const snap = await getDocs(q);
    return snap.docs[0]?.id || null;
  } catch (err) {
    console.error("Error checking existing history:", err);
    return null;
  }
}

async function saveToHistory(templateId, data) {
  try {
    const histId = await existingHistoryId(templateId, data.date);
    const histRef = histId 
      ? doc(window.db, "runsHistory", histId)
      : doc(collection(window.db, "runsHistory"));
    
    const historyData = {
      ...data,
      templateId: templateId,
      historyCreatedAt: Timestamp.now()
    };
    
    await setDoc(histRef, historyData, { merge: true });
    console.log("Saved to history:", histRef.id);
  } catch (err) {
    console.error("Error saving to history:", err);
  }
}