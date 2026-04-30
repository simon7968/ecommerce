// ============================================================
//  EN'DECORE — Firebase Backend (Fixed)
// ============================================================

// ── Replace with YOUR Firebase config ───────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD3o7JSlLcvmItiis-Y-XAj7iStx46ei1A",
  authDomain: "endecore-f8c03.firebaseapp.com",
  projectId: "endecore-f8c03",
  storageBucket: "endecore-f8c03.firebasestorage.app",
  messagingSenderId: "392706019980",
  appId: "1:392706019980:web:1d30c3078b4f69a19361a9"
};

// ── Safe Initialize ──────────────────────────────────────────
let auth, db;
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  auth = firebase.auth();
  db   = firebase.firestore();
} catch (e) {
  console.error('Firebase init error:', e);
}

// ============================================================
//  AUTH
// ============================================================

async function registerUser(email, password, displayName) {
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName });
    await db.collection('users').doc(cred.user.uid).set({
      displayName, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await mergeGuestCart(cred.user.uid);
    showToast(`Welcome to En'Decore, ${displayName}`);
    setTimeout(() => window.location.href = 'account.html', 1500);
  } catch (err) {
    showToast(friendlyError(err.code), 'error');
  }
}

async function loginUser(email, password) {
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    await mergeGuestCart(cred.user.uid);
    showToast(`Welcome back, ${cred.user.displayName || 'dear client'}`);
    setTimeout(() => window.location.href = 'account.html', 1500);
  } catch (err) {
    showToast(friendlyError(err.code), 'error');
  }
}

async function logoutUser() {
  await auth.signOut();
  showToast('You have been signed out');
  setTimeout(() => window.location.href = 'index.html', 1200);
}

function watchAuthState(onLogin, onLogout) {
  auth.onAuthStateChanged(user => {
    if (user) { onLogin && onLogin(user); }
    else       { onLogout && onLogout(); }
  });
}

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use':   'This email is already registered.',
    'auth/invalid-email':          'Please enter a valid email address.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password. Please try again.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/too-many-requests':      'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ============================================================
//  CART
// ============================================================

const CART_KEY = 'endecore_cart';

async function getCart() {
  try {
    const user = auth && auth.currentUser;
    if (user) {
      const snap = await db.collection('carts').doc(user.uid).get();
      return snap.exists ? (snap.data().items || []) : [];
    }
  } catch (e) {
    console.warn('Firestore getCart failed, using localStorage');
  }
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch { return []; }
}

async function addToCart(product) {
  try {
    const cart     = await getCart();
    const existing = cart.find(i => i.id === product.id);
    if (existing) {
      existing.qty += (product.qty || 1);
    } else {
      cart.push({ ...product, qty: product.qty || 1 });
    }
    await saveCart(cart);
    updateCartCount();
    showToast(`"${product.name}" added to your selection`);
  } catch (e) {
    console.error('addToCart error:', e);
    showToast('Could not add to cart. Please try again.', 'error');
  }
}

async function removeFromCart(productId) {
  const cart    = await getCart();
  const updated = cart.filter(i => i.id !== productId);
  await saveCart(updated);
  updateCartCount();
}

async function updateCartQty(productId, qty) {
  const cart = await getCart();
  const item = cart.find(i => i.id === productId);
  if (item) { item.qty = Math.max(1, qty); await saveCart(cart); }
}

async function clearCart() {
  await saveCart([]);
  updateCartCount();
}

async function saveCart(items) {
  try {
    const user = auth && auth.currentUser;
    if (user) {
      await db.collection('carts').doc(user.uid).set({
        items,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return;
    }
  } catch (e) {
    console.warn('Firestore saveCart failed, using localStorage');
  }
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

async function mergeGuestCart(uid) {
  try {
    const guestItems = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (!guestItems.length) return;
    const snap     = await db.collection('carts').doc(uid).get();
    const existing = snap.exists ? (snap.data().items || []) : [];
    guestItems.forEach(g => {
      const found = existing.find(e => e.id === g.id);
      if (found) found.qty += g.qty;
      else existing.push(g);
    });
    await db.collection('carts').doc(uid).set({ items: existing,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    localStorage.removeItem(CART_KEY);
  } catch (e) { console.warn('mergeGuestCart failed:', e); }
}

async function updateCartCount() {
  try {
    const cart  = await getCart();
    const total = cart.reduce((s, i) => s + (i.qty || 1), 0);
    document.querySelectorAll('.cart-count').forEach(el => {
      el.textContent   = total;
      el.style.display = total > 0 ? 'flex' : 'none';
    });
  } catch (e) { console.warn('updateCartCount error:', e); }
}

// ============================================================
//  ORDERS
// ============================================================

async function placeOrder(shippingInfo) {
  const user = auth && auth.currentUser;
  if (!user) {
    showToast('Please sign in to place an order', 'error');
    setTimeout(() => window.location.href = 'account.html', 1500);
    return null;
  }
  const cart = await getCart();
  if (!cart.length) { showToast('Your cart is empty', 'error'); return null; }

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax      = +(subtotal * 0.18).toFixed(2);
  const total    = +(subtotal + tax).toFixed(2);

  try {
    const ref = await db.collection('orders').add({
      userId: user.uid, userEmail: user.email,
      items: cart, shipping: shippingInfo,
      subtotal, tax, total, status: 'confirmed',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await clearCart();
    showToast(`Order #${ref.id.slice(0,8).toUpperCase()} confirmed!`);
    return ref.id;
  } catch (e) {
    console.error('placeOrder error:', e);
    showToast('Order failed. Please try again.', 'error');
    return null;
  }
}

async function getUserOrders() {
  const user = auth && auth.currentUser;
  if (!user) return [];
  try {
    const snap = await db.collection('orders')
      .where('userId', '==', user.uid)
      .orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('getUserOrders error:', e); return []; }
}

// ============================================================
//  CONTACT
// ============================================================

async function submitContactForm(name, email, phone, message) {
  try {
    await db.collection('messages').add({
      name, email, phone, message,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Your message has been received. We will be in touch shortly.');
  } catch (e) {
    showToast('Could not send message. Please try again.', 'error');
  }
}

// ============================================================
//  UI UTILITIES
// ============================================================

function showToast(msg, type = 'success') {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent           = msg;
  t.style.borderLeftColor = type === 'error' ? '#c0392b' : 'var(--gold)';
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function dismissLoader() {
  const loader = document.getElementById('page-loader');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => { if (loader.parentNode) loader.remove(); }, 500);
  }
}

function initMobileMenu() {
  const icon = document.querySelector('.menu-icon');
  const menu = document.querySelector('nav ul');
  if (icon && menu) {
    icon.addEventListener('click', () => menu.classList.toggle('open'));
  }
}

// ── Runs on every page ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  dismissLoader();
  initMobileMenu();
  updateCartCount();

  watchAuthState(user => {
    const w = document.querySelector('.user-welcome');
    if (w) w.textContent = user.displayName || '';
  });
});