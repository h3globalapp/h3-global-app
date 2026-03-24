import { auth, db } from '../firebase-config.js';
import { collection, doc, getDoc, getDocs, onSnapshot, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

class EventsManager {
  constructor() {
    this.els = {
      header: document.getElementById('eventsHeader'),
      btnPrev: document.getElementById('btnPrev'),
      btnNext: document.getElementById('btnNext'),
      btnMonth: document.getElementById('btnMonth'),
      btnYear: document.getElementById('btnYear'),
      tvMonth: document.getElementById('tvMonth'),
      eventList: document.getElementById('eventList'),
      fabAdd: document.getElementById('fabAdd'),
      scroll: document.getElementById('eventsScroll')
    };

    this.currentMode = 'MONTH';
    this.currentDate = new Date();
    this.unsubscribe = null;
    this.currentUser = null;
    this.userRole = '';
    // Store last tap times for each event card
    this.lastTaps = new Map();

    this.init();
  }

  init() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser = user;
        await this.loadUserRole();
        this.setupEventListeners();
        this.updateLabel();
        this.loadEvents();
      } else {
        window.location.href = 'login.html';
      }
    });
  }

  async loadUserRole() {
    try {
      const userDoc = await getDoc(doc(db, 'users', this.currentUser.uid));
      if (userDoc.exists()) {
        this.userRole = userDoc.data().role || '';
        console.log('User role loaded:', this.userRole);
        this.updateUIBasedOnRole();
      }
    } catch (error) {
      console.error('Error loading user role:', error);
    }
  }

  updateUIBasedOnRole() {
    if (this.userRole === 'Tier 1' || this.userRole === 'Tier 2') {
      this.els.fabAdd.classList.remove('hidden');
      console.log('FAB shown for admin user');
    } else {
      this.els.fabAdd.classList.add('hidden');
      console.log('FAB hidden for non-admin user');
    }
  }

  setupEventListeners() {
    this.els.btnPrev.onclick = () => this.shiftPeriod(-1);
    this.els.btnNext.onclick = () => this.shiftPeriod(1);
    this.els.btnMonth.onclick = () => this.setMode('MONTH');
    this.els.btnYear.onclick = () => this.setMode('YEAR');
    this.els.fabAdd.onclick = () => {
      window.location.href = 'add-event.html';
    };

    this.els.scroll.onscroll = () => {
      const scrollTop = this.els.scroll.scrollTop;
      this.els.header.style.transform = scrollTop > 50 ? 'translateY(-100%)' : 'translateY(0)';
      this.els.header.style.transition = 'transform 0.3s';
    };
  }

  fmtYM(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  fmtY(d) {
    return `${d.getFullYear()}`;
  }

  fmtDisplayMonth(d) {
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  fmtDisplayYear(d) {
    return `${d.getFullYear()}`;
  }

  updateLabel() {
    this.els.tvMonth.textContent = this.currentMode === 'MONTH'
      ? this.fmtDisplayMonth(this.currentDate)
      : this.fmtDisplayYear(this.currentDate);
  }

  shiftPeriod(dir) {
    if (this.currentMode === 'MONTH') {
      this.currentDate.setMonth(this.currentDate.getMonth() + dir);
    } else {
      this.currentDate.setFullYear(this.currentDate.getFullYear() + dir);
    }
    this.updateLabel();
    this.loadEvents();
  }

  setMode(mode) {
    this.currentMode = mode;
    this.els.btnMonth.classList.toggle('active', mode === 'MONTH');
    this.els.btnYear.classList.toggle('active', mode === 'YEAR');
    this.updateLabel();
    this.loadEvents();
  }

  monthOverlap(event, yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    return !(eventEnd < monthStart || eventStart > monthEnd);
  }

  yearOverlap(event, year) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    return !(eventEnd < yearStart || eventStart > yearEnd);
  }

  loadEvents() {
    if (this.unsubscribe) this.unsubscribe();

    const q = query(collection(db, 'events'), orderBy('startDate', 'desc'));

    this.unsubscribe = onSnapshot(q, (snap) => {
      const allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      const periodKey = this.currentMode === 'MONTH'
        ? this.fmtYM(this.currentDate)
        : this.fmtY(this.currentDate);

      const filtered = allEvents.filter(e =>
        this.currentMode === 'MONTH'
          ? this.monthOverlap(e, periodKey)
          : this.yearOverlap(e, periodKey)
      );

      if (this.currentMode === 'YEAR') {
        filtered.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      }

      this.renderEvents(filtered);
    });
  }

renderEvents(events) {
  if (events.length === 0) {
    this.els.eventList.innerHTML = '<p class="no-events">No events for this period</p>';
    return;
  }

  this.els.eventList.innerHTML = events.map(e => `
    <div class="event-card" data-id="${e.id}">
      <div class="event-logo">
        <img src="${e.imageUrl || 'icons/default_kennel.png'}" alt="kennel logo" onerror="this.src='icons/default_kennel.png'"/>
      </div>
      <div class="event-content">
        <div class="event-title">${e.title || 'Untitled Event'}</div>
        <div class="event-dates">${this.formatDateRange(e.startDate, e.endDate)} • ${e.time || 'Time TBD'}</div>
        <button class="btn-who-coming" style="background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: 8px; font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">👥 Who Is Coming</button>      </div>
    </div>
  `).join('');

  const lastTaps = new Map();
  const pendingTimeouts = new Map();
  
  // Setup Who Is Coming buttons FIRST
  document.querySelectorAll('.btn-who-coming').forEach((btn) => {
    btn.addEventListener('click', async (evt) => {
      evt.stopPropagation();      
      evt.stopImmediatePropagation();
      evt.preventDefault();
      
      const card = btn.closest('.event-card');
      if (!card) return;
      
      const eventId = card.dataset.id;
      if (!eventId) return;
      
      console.log('Button clicked for event:', eventId);
      await this.showWhoIsComingDialog(eventId);
    });
  });
  
  // Setup card click handlers AFTER
  document.querySelectorAll('.event-card').forEach((card) => {
    const eventId = card.dataset.id;
    
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-who-coming')) return;
      
      const currentTime = new Date().getTime();
      const lastTap = lastTaps.get(eventId) || 0;
      const tapLength = currentTime - lastTap;
      
      if (tapLength < 300 && tapLength > 0) {
        const pendingTimeout = pendingTimeouts.get(eventId);
        if (pendingTimeout) {
          clearTimeout(pendingTimeout);
          pendingTimeouts.delete(eventId);
        }
        
        if (this.userRole === 'Tier 1' || this.userRole === 'Tier 2') {
          window.location.href = `add-event.html?edit=${eventId}`;
        }
      } else {
        const timeoutId = setTimeout(() => {
          pendingTimeouts.delete(eventId);
          window.location.href = `event-detail.html?id=${eventId}`;
        }, 300);
        
        pendingTimeouts.set(eventId, timeoutId);
      }
      
      lastTaps.set(eventId, currentTime);
    });
  });
  
  console.log('Finished setting up all event listeners');
}
	
  formatDateRange(startDate, endDate) {
    if (!startDate) return 'Date TBD';
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : start;
    
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    
    if (sameMonth) {
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.getDate()}, ${end.getFullYear()}`;
    } else {
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  }

  formatDate(dateStr) {
    if (!dateStr) return 'TBD';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

async showWhoIsComingDialog(eventId) {
  console.log('Starting showWhoIsComingDialog for eventId:', eventId);
  
  try {
    // Get event data
    console.log('Fetching event doc...');
    const eventDoc = await getDoc(doc(db, 'events', eventId));
    
    if (!eventDoc.exists()) {
      console.error('Event not found:', eventId);
      alert('Event not found');
      return;
    }
    
    const eventData = eventDoc.data();
    console.log('Event data loaded:', eventData.title);

    // Get payment requests for this event
    console.log('Fetching payment requests...');
    const paymentsQuery = query(
      collection(db, 'paymentRequests'),
      where('eventId', '==', eventId),
      where('type', '==', 'event-payment')
    );
    
    const paymentsSnap = await getDocs(paymentsQuery);
    console.log('Payment requests found:', paymentsSnap.size);

    // Extract all hashers from rego payments
    const regoHashers = [];
    
    paymentsSnap.forEach(doc => {
      const data = doc.data();
      
      // LEGACY: Check regoForHashers array
      const regoForHashers = data.regoForHashers || [];
      regoForHashers.forEach(hasher => {
        if (hasher && !regoHashers.includes(hasher)) {
          regoHashers.push(hasher);
        }
      });
      
      // NEW FORMAT: Check regoSelf
      const regoSelf = data.regoSelf;
      if (regoSelf?.selected && regoSelf.amount > 0) {
        const payerHandle = data.userHashHandle || data.payerHandle || 'Unknown';
        if (payerHandle && !regoHashers.includes(payerHandle)) {
          regoHashers.push(payerHandle);
        }
      }
      
      // NEW FORMAT: Check regoOthers array
      const regoOthers = data.regoOthers || [];
      regoOthers.forEach(other => {
        if (other.hashHandle && !regoHashers.includes(other.hashHandle)) {
          regoHashers.push(other.hashHandle);
        }
      });
    });

    console.log('Total hashers found:', regoHashers.length);

    // Remove any existing dialog first
    const existingDialog = document.querySelector('.dialog-overlay');
    if (existingDialog) {
      existingDialog.remove();
    }

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'dialog-overlay';
    dialog.style.cssText = `
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
      padding: 20px;
    `;
    
    dialog.innerHTML = `
      <div class="who-coming-dialog" style="background: white; border-radius: 12px; padding: 20px; max-width: 400px; width: 100%; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 2px solid var(--clr-primary); padding-bottom: 12px;">
          <h3 style="margin: 0; color: var(--clr-primary); font-size: 18px;">👥 Who Is Coming</h3>
          <button class="btn-close-who" style="background: none; border: none; font-size: 28px; cursor: pointer; color: #666; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">&times;</button>
        </div>
        
        <div style="margin-bottom: 16px; padding: 12px; background: #f0f0f0; border-radius: 8px;">
          <div style="font-weight: bold; color: #333; margin-bottom: 4px;">🎉 ${eventData.title || 'Event'}</div>
          <div style="color: #666; font-size: 14px;">📅 ${this.formatDateRange(eventData.startDate, eventData.endDate)}</div>
        </div>
        
        ${regoHashers.length === 0 ? 
          `<div style="text-align: center; color: #666; padding: 30px 20px; background: #fafafa; border-radius: 8px;">
            <div style="font-size: 32px; margin-bottom: 8px;">🍺</div>
            <p style="margin: 0;">No hashers registered yet</p>
           </div>` :
          `<div style="background: #f8f9fa; border-radius: 8px; padding: 16px; border: 1px solid #e0e0e0;">
            <div style="margin-bottom: 12px; font-weight: bold; color: var(--clr-primary); font-size: 16px; display: flex; align-items: center; gap: 8px;">
              <span>🍺</span>
              <span>${regoHashers.length} Hasher${regoHashers.length !== 1 ? 's' : ''} Registered</span>
            </div>
            <ol style="margin: 0; padding-left: 20px; line-height: 2;">
              ${regoHashers.map((hasher, idx) => `
                <li style="padding: 4px 0; ${idx < regoHashers.length - 1 ? 'border-bottom: 1px solid #e0e0e0;' : ''}">
                  <span style="font-weight: 500; color: #333;">${hasher}</span>
                </li>
              `).join('')}
            </ol>
          </div>`
        }
        
        <div style="margin-top: 20px; text-align: center;">
          <button class="btn-done-who" style="background: var(--clr-primary); color: white; border: none; padding: 12px 32px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">ON ON!</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);
    console.log('Dialog added to DOM');

    // Close handlers
    const closeDialog = () => {
      console.log('Closing dialog');
      dialog.remove();
    };
    
    dialog.querySelector('.btn-close-who').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-done-who').addEventListener('click', closeDialog);
    
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    console.log('Dialog setup complete');

  } catch (err) {
    console.error('Error in showWhoIsComingDialog:', err);
    alert('Failed to load registration list: ' + err.message);
  }
}
}



document.addEventListener('DOMContentLoaded', () => {
  new EventsManager();
});