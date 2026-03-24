import { SubscriptionDialogs } from './subscription-dialogs.js';

export class NavigationGuard {
  constructor(functions, auth, db) {
    this.functions = functions;
    this.auth = auth;
    this.db = db;
    this.dialogs = new SubscriptionDialogs(functions);
    this.userData = null;
    this.currentUser = null;
    this.isChecking = false;
    
    // Pages that don't require subscription
    this.exemptPages = ['login.html', 'signup.html'];
    
    // Track if we're already showing a dialog to prevent loops
    this.dialogOpen = false;
  }

  initialize(user, userData) {
    this.currentUser = user;
    this.userData = userData;
    this.dialogs.setUserData(user, userData);
    
    // Start intercepting navigation
    this.setupInterception();
    
    // Initial check
    this.checkAndEnforce();
  }

  updateUserData(newData) {
    this.userData = newData;
    this.dialogs.setUserData(this.currentUser, newData);
    
    // If dialog is open and status changed, re-check
    if (this.dialogOpen) {
      this.checkAndEnforce();
    }
  }

  setupInterception() {
    // Intercept link clicks
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('javascript:')) return;
      
      // Don't intercept if it's the same page
      if (href === window.location.pathname.split('/').pop()) return;
      
      e.preventDefault();
      this.handleNavigation(href);
    });

    // Intercept form submissions that navigate
    document.addEventListener('submit', (e) => {
      if (e.target.tagName === 'FORM' && e.target.action) {
        // Check before allowing form navigation
        const canProceed = this.checkSync();
        if (!canProceed) {
          e.preventDefault();
          this.checkAndEnforce();
        }
      }
    });
  }

  // Synchronous check for quick decisions
  checkSync() {
    if (!this.userData) return false;
    if (this.isExemptPage()) return true;
    
    const hasWallet = !!this.userData.titanAccountNumber;
    const hasTier = !!this.userData.subscriptionTier;
    const subStatus = this.userData.subscriptionStatus;
    const now = new Date();
    const trialEnds = this.userData.trialEndsAt?.toDate?.();
    const isTrialValid = subStatus === 'trial' && trialEnds && trialEnds > now;
    const isActive = subStatus === 'active';
    
    return hasWallet && hasTier && (isTrialValid || isActive);
  }

  // Full async check with enforcement
  async checkAndEnforce() {
    if (this.isChecking || this.isExemptPage()) return;
    this.isChecking = true;

    const status = await this.getDetailedStatus();
    
    switch (status) {
      case 'wallet-required':
        this.dialogOpen = true;
        this.dialogs.showWalletRequired(async () => {
          const created = await this.dialogs.createUserWallet();
          if (created) {
            this.dialogOpen = false;
            // Reload user data and re-check
            window.location.reload();
          }
        });
        break;
        
      case 'subscription-required':
        this.dialogOpen = true;
        this.dialogs.showPaywall(async (tier, amount) => {
          const selected = await this.dialogs.selectTier(tier, amount);
          if (selected) {
            this.dialogOpen = false;
            window.location.reload();
          }
        });
        break;
        
      case 'expired':
        this.dialogOpen = true;
        this.dialogs.showExpired(async () => {
          // Try to deduct
          const deducted = await this.dialogs.attemptDeduction();
          if (deducted) {
            this.dialogOpen = false;
            alert('✅ Subscription renewed!');
            window.location.reload();
          } else {
            alert('❌ Still insufficient funds. Please send more money.');
          }
        });
        break;
        
      case 'allowed':
        this.dialogOpen = false;
        this.dialogs.clearExistingDialogs();
        break;
    }

    this.isChecking = false;
    return status;
  }

  async getDetailedStatus() {
    if (!this.userData) return 'no-user';
    
    // 1. Check wallet
    if (!this.userData.titanAccountNumber) {
      return 'wallet-required';
    }

    // 2. Check if tier selected
    if (!this.userData.subscriptionTier) {
      return 'subscription-required';
    }

    // 3. Check trial/expiration
    const now = new Date();
    const trialEndsAt = this.userData.trialEndsAt?.toDate?.();
    const subStatus = this.userData.subscriptionStatus;

    if (subStatus === 'trial' && trialEndsAt && trialEndsAt > now) {
      return 'allowed';
    }

    if (subStatus === 'trial' && trialEndsAt && trialEndsAt <= now) {
      // Try silent deduction first
      const deducted = await this.dialogs.attemptDeduction();
      return deducted ? 'allowed' : 'expired';
    }

    if (subStatus === 'expired') {
      return 'expired';
    }

    return 'allowed';
  }

  async handleNavigation(targetUrl) {
    const status = await this.getDetailedStatus();
    
    // If allowed, navigate immediately
    if (status === 'allowed' || this.isExemptPath(targetUrl)) {
      window.location.href = targetUrl;
      return;
    }
    
    // Otherwise, show appropriate dialog
    // Store target for after they fix the issue
    if (targetUrl && targetUrl !== window.location.href) {
      sessionStorage.setItem('pendingNavigation', targetUrl);
    }
    
    this.checkAndEnforce();
  }

  isExemptPage() {
    const current = window.location.pathname.split('/').pop() || 'index.html';
    return this.exemptPages.includes(current);
  }

  isExemptPath(url) {
    const page = url.split('/').pop() || 'index.html';
    return this.exemptPages.includes(page);
  }

  // Call this when user data updates from Firestore
  onUserDataUpdated(newData) {
    this.updateUserData(newData);
  }
}