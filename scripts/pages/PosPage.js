import { userStore } from '../state/userStore.js';
import { productStore } from '../state/productStore.js';
import { cartStore } from '../state/cartStore.js';
import { findOrCreateActiveShift } from '../api/shiftApi.js';
import { createSaleTransaction } from '../api/salesApi.js';
import { getProductsWithStock } from '../api/productApi.js';
import { navigate } from '../router/index.js';
import { Modal } from '../components/common/Modal.js';

let activeCategory = null;
let cleanupFuncs = [];

function chunk(arr, size) {
  const chunks = [];
  if (!arr) return chunks;
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function renderProductCard(product) {
  const isOutOfStock = product.stock <= 0;
  const imageUrl =
    product.imageUrl ||
    'https://placehold.co/300x300/e2e8f0/64748b?text=No+Image';
  const disabledAttribute = isOutOfStock ? 'disabled' : '';
  const priceDisplay = product.price
    ? `${product.price}`
    : (product.prices || []).join('/');
  const lowStockIndicator =
    product.stock > 0 && product.stock < 5
      ? `<div class="product-card__low-stock">สต็อกใกล้หมด</div>`
      : '';
  return `<button class="product-item" data-product-id="${product.id}" ${disabledAttribute}>
    <div class="product-item__image-wrapper">
      <img src="${imageUrl}" alt="${product.name}" class="product-item__image">
    </div>
    <div class="product-item__info">
      <h3 class="product-item__name">${product.name}</h3>
      <div class="product-item__details">
        <span class="product-item__price">${priceDisplay}.-</span>
        <span class="product-item__stock">เหลือ ${product.stock}</span>
      </div>
    </div>
  </button>`;
}

function renderFilteredProducts() {
  const productsByCategory = productStore.getProductsByCategory();
  const productCarousel = document.getElementById('product-carousel');
  if (!productCarousel) return;

  if (!activeCategory || !productsByCategory[activeCategory]) {
    activeCategory = Object.keys(productsByCategory)[0] || null;
  }

  document.querySelectorAll('.category-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.category === activeCategory);
  });

  const productsToShow = productsByCategory[activeCategory] || [];
  const productPages = chunk(productsToShow, 4);

  if (productPages.length === 0) {
    productCarousel.innerHTML =
      '<p class="no-products-message">ไม่มีสินค้าในหมวดหมู่นี้</p>';
    return;
  }

  productCarousel.innerHTML = productPages
    .map(
      (page) =>
        `<div class="product-page">${page
          .map(renderProductCard)
          .join('')}</div>`
    )
    .join('');
}

function renderSummaryBar() {
  const summaryBar = document.getElementById('summary-bar');
  if (!summaryBar) return;

  const total = cartStore.getCartTotal();
  const itemCount = cartStore.getCartItemCount();

  if (itemCount === 0) {
    summaryBar.classList.remove('visible');
    return;
  }

  summaryBar.classList.add('visible');
  summaryBar.innerHTML = `
    <div class="summary-text" id="summary-bar-text">
      <span>${itemCount} รายการ</span>
      <strong>รวม ${total.toFixed(2)} บาท</strong>
    </div>
    <button class="checkout-button-main" id="checkout-btn">ชำระเงิน</button>
  `;
}

function openPriceSelectionModal(product) {
  console.log('[DEBUG] openPriceSelectionModal CALLED', product);

  const prices = product.prices || [];
  const contentHtml = `
    <div class="price-modal">
      <h3 class="price-modal__title">เลือกราคาสำหรับ "${product.name}"</h3>
      <div class="price-modal__buttons" id="price-options">
        ${prices
          .map(
            (price) =>
              `<button class="price-btn" data-price="${price}">${price} บาท</button>`
          )
          .join('')}
      </div>
    </div>
  `;

  const afterOpen = () => {
    console.log('[DEBUG] afterOpen in price modal triggered');
    const optionsEl = document.getElementById('price-options');
    console.log('[DEBUG] price-options element =', optionsEl);

    optionsEl?.addEventListener('click', (e) => {
      const priceButton = e.target.closest('.price-btn');
      console.log('[DEBUG] clicked price button =', priceButton);
      if (priceButton) {
        const selectedPrice = parseFloat(priceButton.dataset.price);
        console.log('[DEBUG] Selected price:', selectedPrice);
        cartStore.addItem(product, selectedPrice);
        Modal.close();
      }
    });
  };

  console.log('[DEBUG] Modal.open will be called now');
  Modal.open(contentHtml, afterOpen);
}

function showSuccessAnimation(onComplete) {
  const animationHtml = `
    <div class="success-animation">
      <div class="progress-bar" id="success-progress-bar"></div>
      <span id="success-progress-text">0%</span>
    </div>
  `;
  Modal.open(animationHtml, () => {
    const bar = document.getElementById('success-progress-bar');
    const text = document.getElementById('success-progress-text');
    let width = 0;
    const interval = setInterval(() => {
      if (width >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          Modal.close();
          onComplete();
        }, 500);
      } else {
        width++;
        bar.style.width = `${width}%`;
        text.textContent = `${width}%`;
      }
    }, 15);
  });
}

async function handleCheckout(paymentType, cashReceived = 0) {
  Modal.close();
  const currentUser = userStore.getCurrentUser();
  const cart = cartStore.getCart();
  const total = cartStore.getCartTotal();

  if (paymentType === 'cash' && cashReceived < total) {
    alert('จำนวนเงินที่รับมาไม่เพียงพอ');
    return;
  }

  const shift = await findOrCreateActiveShift({ employeeId: currentUser.id });
  if (!shift) {
    alert('ไม่สามารถหากะการทำงานได้');
    return;
  }

  const saleData = {
    shiftId: shift.id,
    employeeId: currentUser.id,
    paymentType: paymentType,
    shopId: currentUser.shopId,
    cartItems: cart.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    })),
  };

  const { success, error } = await createSaleTransaction(saleData);
  if (success) {
    showSuccessAnimation(async () => {
      cartStore.clearCart();
      const updatedProducts = await getProductsWithStock(currentUser.shopId);
      productStore.setProducts(updatedProducts);
    });
  } else {
    alert(`เกิดข้อผิดพลาดในการบันทึกการขาย: ${error.message}`);
  }
}

function openPaymentModal() {
  const total = cartStore.getCartTotal();
  const cart = cartStore.getCart();

  const contentHtml = `
    <div class="payment-modal-final">
      <div class="payment-modal-header">สรุปรายการ</div>
      <div class="payment-modal-items">
        ${cart
          .map(
            (item) =>
              `<div class="payment-modal-item">
                <span>${item.name} (x${item.quantity})</span>
                <span>${(item.price * item.quantity).toFixed(2)}</span>
              </div>`
          )
          .join('')}
      </div>
      <div class="payment-modal-total">
        <span>ยอดรวม</span>
        <strong>${total.toFixed(2)} บาท</strong>
      </div>
      <div class="payment-method" id="payment-method-selector">
        <button class="payment-btn" data-method="transfer">โอนชำระ</button>
        <button class="payment-btn active" data-method="cash">เงินสด</button>
      </div>
      <div class="cash-section" id="cash-section">
        <label for="cash-received">รับเงินมา (บาท):</label>
        <input type="number" id="cash-received" class="cash-input" placeholder="0.00">
        <p class="change-display">เงินทอน: <span id="change-amount">0.00</span> บาท</p>
      </div>
      <div class="payment-modal__actions">
        <button class="confirm-btn" id="confirm-payment-btn">ยืนยันการขาย</button>
      </div>
    </div>
  `;

  const afterOpen = () => {
    let selectedPayment = 'cash';
    const cashSection = document.getElementById('cash-section');
    const cashInput = document.getElementById('cash-received');
    const changeAmount = document.getElementById('change-amount');

    document
      .getElementById('payment-method-selector')
      ?.addEventListener('click', (e) => {
        const btn = e.target.closest('.payment-btn');
        if (!btn) return;
        document
          .querySelectorAll('.payment-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPayment = btn.dataset.method;
        cashSection.style.display = selectedPayment === 'cash' ? 'block' : 'none';
      });

    cashInput?.addEventListener('input', () => {
      const received = parseFloat(cashInput.value) || 0;
      const change = received - total;
      changeAmount.textContent = change > 0 ? change.toFixed(2) : '0.00';
    });

    document
      .getElementById('confirm-payment-btn')
      ?.addEventListener('click', () => {
        const cashReceived = parseFloat(cashInput.value) || 0;
        handleCheckout(selectedPayment, cashReceived);
      });
  };

  Modal.open(contentHtml, afterOpen);
}

export function PosPage() {
  if (productStore.getProducts().length === 0) {
    setTimeout(async () => {
      const currentUser = userStore.getCurrentUser();
      if (currentUser) {
        const products = await getProductsWithStock(currentUser.shopId);
        productStore.setProducts(products);
        navigate('/pos');
      }
    }, 0);
    return { view: `<div class="loading-spinner"></div>` };
  }

  const productsByCategory = productStore.getProductsByCategory();
  const categories = Object.keys(productsByCategory);

  if (!activeCategory || !productsByCategory[activeCategory]) {
    activeCategory = categories[0] || null;
  }

  const categoryPillsHtml = categories
    .map(
      (cat) =>
        `<button class="category-pill ${
          cat === activeCategory ? 'active' : ''
        }" data-category="${cat}">${cat}</button>`
    )
    .join('');

  const view = `
    <div class="page-content-wrapper" id="pos-page-wrapper">
      <header class="pos-page-header">
        <h1 class="pos-logo">TEXAS</h1>
        <button id="search-btn" class="header-icon-btn" title="ค้นหา">
          <i class="bi bi-search"></i>
        </button>
      </header>
      <nav class="category-selector" id="category-selector">
        ${categoryPillsHtml}
      </nav>
      <main class="pos-main-content">
        <div class="product-carousel" id="product-carousel"></div>
      </main>
      <footer class="summary-bar" id="summary-bar"></footer>
    </div>
  `;

  const postRender = () => {
    if (cleanupFuncs.length > 0) {
      cleanupFuncs.forEach((cf) => cf());
      cleanupFuncs = [];
    }

    const wrapper = document.getElementById('pos-page-wrapper');
    const unsubscribeCart = cartStore.subscribe(renderSummaryBar);

    const handleWrapperClick = (e) => {
      const categoryPill = e.target.closest('.category-pill');
      if (categoryPill) {
        activeCategory = categoryPill.dataset.category;
        renderFilteredProducts();
        return;
      }

      const productCard = e.target.closest('.product-item');
      if (productCard && !productCard.disabled) {
        const productId = productCard.dataset.productId;
        const product = productStore.getProductById(productId);
        console.log('[DEBUG] Clicked productCard → product:', product);
        if (product) {
          const hasMultiplePrices =
            product.prices && product.prices.length > 0;
          if (hasMultiplePrices) {
            openPriceSelectionModal(product);
          } else if (product.price) {
            cartStore.addItem(product, product.price);
          }
        }
        return;
      }

      if (e.target.closest('#checkout-btn')) {
        console.log('[DEBUG] Checkout button clicked');
        openPaymentModal();
      }
    };

    wrapper?.addEventListener('click', handleWrapperClick);

    renderFilteredProducts();
    renderSummaryBar();

    cleanupFuncs.push(() =>
      wrapper?.removeEventListener('click', handleWrapperClick)
    );
    cleanupFuncs.push(unsubscribeCart);
  };

  return { view, postRender };
}
