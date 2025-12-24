const { Resend } = require('resend');

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper function to generate items HTML with images
const generateItemsHTML = (items, showImages = true) => {
  return items.map(item => {
    const hasPieces = item.selectedPieces && item.selectedPieces > 1;
    const pricePerPiece = item.pricePerPiece || item.price;
    const imageUrl = item.image || (item.images && item.images[0]) || '';
    
    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">
          <div style="display: flex; align-items: center; gap: 12px;">
            ${showImages && imageUrl ? `
              <img 
                src="${imageUrl}" 
                alt="${item.name}" 
                style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px; border: 1px solid #eee;"
              />
            ` : ''}
            <div>
              <strong style="display: block; margin-bottom: 4px;">${item.name}</strong>
              ${hasPieces ? `
                <div style="font-size: 12px; color: #059669; font-weight: 600;">
                  📦 ${item.selectedPieces} pieces (₦${pricePerPiece.toLocaleString()}/pc)
                </div>
              ` : ''}
              ${item.selectedSize || item.selectedColor ? `
                <div style="font-size: 12px; color: #888; margin-top: 4px;">
                  ${item.selectedSize ? `Size: <strong>${item.selectedSize}</strong>` : ''}
                  ${item.selectedSize && item.selectedColor ? ' | ' : ''}
                  ${item.selectedColor ? `Color: <strong>${item.selectedColor}</strong>` : ''}
                </div>
              ` : ''}
            </div>
          </div>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
          ${item.quantity}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
          ₦${item.price.toLocaleString()}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
          <strong>₦${(item.price * item.quantity).toLocaleString()}</strong>
        </td>
      </tr>
    `;
  }).join('');
};

// Helper function for compact items (3 columns)
const generateCompactItemsHTML = (items) => {
  return items.map(item => {
    const hasPieces = item.selectedPieces && item.selectedPieces > 1;
    const pricePerPiece = item.pricePerPiece || item.price;
    const imageUrl = item.image || (item.images && item.images[0]) || '';
    
    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">
          <div style="display: flex; align-items: center; gap: 12px;">
            ${imageUrl ? `
              <img 
                src="${imageUrl}" 
                alt="${item.name}" 
                style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid #eee;"
              />
            ` : ''}
            <div>
              <strong style="display: block; margin-bottom: 4px;">${item.name}</strong>
              ${hasPieces ? `
                <div style="font-size: 11px; color: #059669; font-weight: 600;">
                  📦 ${item.selectedPieces} pcs (₦${pricePerPiece.toLocaleString()}/pc)
                </div>
              ` : ''}
              ${item.selectedSize || item.selectedColor ? `
                <div style="font-size: 11px; color: #888; margin-top: 2px;">
                  ${item.selectedSize ? `Size: ${item.selectedSize}` : ''}
                  ${item.selectedSize && item.selectedColor ? ' | ' : ''}
                  ${item.selectedColor ? `Color: ${item.selectedColor}` : ''}
                </div>
              ` : ''}
            </div>
          </div>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
          ${item.quantity}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
          <strong>₦${(item.price * item.quantity).toLocaleString()}</strong>
        </td>
      </tr>
    `;
  }).join('');
};

// Send order confirmation email
exports.sendOrderConfirmation = async (orderData) => {
  try {
    const { customerInfo, items, totalAmount, orderNumber } = orderData;

    const itemsHTML = generateItemsHTML(items);

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: customerInfo.email,
      subject: `✨ Order Confirmation - #${orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6; 
              color: #333;
              margin: 0;
              padding: 0;
              background-color: #f5f5f5;
            }
            .email-container { 
              max-width: 600px; 
              margin: 40px auto; 
              background: white;
              border-radius: 16px;
              overflow: hidden;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header { 
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); 
              color: white; 
              padding: 40px 30px; 
              text-align: center;
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 28px;
              font-weight: 600;
            }
            .content { padding: 40px 30px; }
            .content h3 { color: #f5576c; font-size: 18px; margin: 30px 0 15px 0; }
            table { width: 100%; border-collapse: collapse; margin: 25px 0; }
            th {
              background: #f8f9fa;
              padding: 12px;
              text-align: left;
              font-weight: 600;
              color: #555;
            }
            .total-row { background: #f8f9fa; font-weight: 600; font-size: 18px; }
            .total-row td { padding: 20px 12px !important; border-top: 2px solid #f5576c; }
            .address-box {
              background: #f8f9fa;
              border-left: 4px solid #f5576c;
              padding: 20px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h1>✨ Order Received!</h1>
              <p>Order #${orderNumber}</p>
            </div>
            
            <div class="content">
              <p>Dear <strong>${customerInfo.fullName}</strong>,</p>
              <p>Thank you for your order! We've received it and will process your payment shortly.</p>
              
              <h3>📦 Order Summary</h3>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th style="text-align: center;">Qty</th>
                    <th style="text-align: right;">Price</th>
                    <th style="text-align: right;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHTML}
                  <tr class="total-row">
                    <td colspan="3" style="text-align: right;"><strong>Total:</strong></td>
                    <td style="text-align: right; color: #f5576c;"><strong>₦${totalAmount.toLocaleString()}</strong></td>
                  </tr>
                </tbody>
              </table>
              
              <h3>🚚 Shipping Address</h3>
              <div class="address-box">
                <p><strong>${customerInfo.fullName}</strong></p>
                <p>${customerInfo.address}</p>
                <p>${customerInfo.city}, ${customerInfo.state}</p>
                <p>📱 ${customerInfo.phone}</p>
                ${customerInfo.shippingMethod ? `<p style="margin-top: 10px; color: #f5576c;"><strong>Shipping:</strong> ${customerInfo.shippingMethod}</p>` : ''}
              </div>
              
              <p><strong>What's Next?</strong> Complete your payment and we'll send you a confirmation email with tracking details.</p>
            </div>
            
            <div class="footer">
              <p><strong>Anjola Aesthetics Ng</strong></p>
              <p>hello@anjolaaestheticsng.com</p>
              <p>&copy; ${new Date().getFullYear()} Anjola Aesthetics Ng. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ Order confirmation email sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Order email error:', error);
    return { success: false, error: error.message };
  }
};

// Send payment confirmation email
exports.sendPaymentConfirmation = async (orderData) => {
  try {
    const { customerInfo, totalAmount, orderNumber, paymentReference, items } = orderData;

    const itemsHTML = items ? generateCompactItemsHTML(items) : '';

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: customerInfo.email,
      subject: `💳 Payment Confirmed - Order #${orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
            .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; }
            .header { background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%); color: white; padding: 50px 30px; text-align: center; }
            .success-icon { font-size: 80px; margin-bottom: 20px; }
            .content { padding: 40px 30px; }
            .amount-box { background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%); color: white; padding: 30px; text-align: center; border-radius: 12px; margin: 30px 0; }
            .amount-box .amount { font-size: 42px; font-weight: 700; margin: 0; }
            .info-box { background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #84fab0; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background: #f8f9fa; padding: 12px; text-align: left; }
            td { padding: 12px; border-bottom: 1px solid #eee; }
            .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="success-icon">✅</div>
              <h1>Payment Successful!</h1>
            </div>
            
            <div class="content">
              <p>Dear <strong>${customerInfo.fullName}</strong>,</p>
              <p>Great news! Your payment has been confirmed and your order is now being processed.</p>
              
              <div class="amount-box">
                <div style="font-size: 14px; opacity: 0.9; margin-bottom: 10px;">Amount Paid</div>
                <div class="amount">₦${totalAmount.toLocaleString()}</div>
              </div>
              
              <div class="info-box">
                <p><strong>Order Number:</strong> #${orderNumber}</p>
                <p><strong>Payment Reference:</strong> ${paymentReference}</p>
                <p><strong>Status:</strong> <span style="color: #28a745;">✓ Paid & Processing</span></p>
              </div>
              
              ${items && items.length > 0 ? `
                <h3 style="color: #84fab0;">📦 Your Items</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style="text-align: center;">Qty</th>
                      <th style="text-align: right;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHTML}
                  </tbody>
                </table>
              ` : ''}
              
              <h3 style="color: #84fab0;">🚚 What's Next?</h3>
              <p>We're carefully packaging your items. You'll receive a shipping confirmation email with tracking information within 24-48 hours.</p>
              
              <p style="margin-top: 30px;">Thank you for choosing <strong>Anjola Aesthetics Ng</strong>! ✨</p>
            </div>
            
            <div class="footer">
              <p><strong>Anjola Aesthetics Ng</strong></p>
              <p>hello@anjolaaestheticsng.com</p>
              <p>&copy; ${new Date().getFullYear()} Anjola Aesthetics Ng. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ Payment confirmation email sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Payment email error:', error);
    return { success: false, error: error.message };
  }
};

// Send shipped notification
exports.sendShippedNotification = async (orderData) => {
  try {
    const { customerInfo, orderNumber, trackingNumber, items, totalAmount } = orderData;

    const itemsHTML = items && items.length > 0 ? generateCompactItemsHTML(items) : '';

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: customerInfo.email,
      subject: `🚚 Your Order Has Shipped - #${orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
            .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 50px 30px; text-align: center; }
            .icon { font-size: 80px; margin-bottom: 20px; }
            .content { padding: 40px 30px; }
            .tracking-box { background: #f8f9fa; padding: 30px; text-align: center; border-radius: 12px; margin: 30px 0; border: 2px dashed #667eea; }
            .tracking-number { font-size: 24px; font-weight: 700; color: #667eea; letter-spacing: 2px; }
            .info-box { background: #e3f2fd; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #2196f3; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background: #f8f9fa; padding: 12px; text-align: left; }
            td { padding: 12px; border-bottom: 1px solid #eee; }
            .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">🚚</div>
              <h1>Your Order Is On Its Way!</h1>
              <p>Order #${orderNumber}</p>
            </div>
            
            <div class="content">
              <p>Dear <strong>${customerInfo.fullName}</strong>,</p>
              <p>Exciting news! Your order has been shipped and is on its way to you!</p>
              
              ${trackingNumber ? `
                <div class="tracking-box">
                  <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">Tracking Number</p>
                  <div class="tracking-number">${trackingNumber}</div>
                  <p style="margin: 15px 0 0 0; font-size: 13px; color: #999;">Use this to track your package</p>
                </div>
              ` : ''}
              
              ${items && items.length > 0 ? `
                <h3 style="color: #667eea;">📦 Items Being Shipped</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style="text-align: center;">Qty</th>
                      <th style="text-align: right;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHTML}
                  </tbody>
                </table>
                ${totalAmount ? `
                  <p style="text-align: right; font-size: 18px; font-weight: bold; color: #667eea;">
                    Total: ₦${totalAmount.toLocaleString()}
                  </p>
                ` : ''}
              ` : ''}
              
              <div class="info-box">
                <p style="margin: 0;"><strong>📦 Delivery Address:</strong></p>
                <p style="margin: 10px 0 0 0;">${customerInfo.address}, ${customerInfo.city}, ${customerInfo.state}</p>
                <p style="margin: 5px 0 0 0;">📱 ${customerInfo.phone}</p>
              </div>
              
              <h3 style="color: #667eea;">⏱️ Expected Delivery</h3>
              <p>Your package should arrive within <strong>3-5 business days</strong>. We'll notify you once it's delivered!</p>
              
              <p style="margin-top: 30px;">Thank you for shopping with <strong>Anjola Aesthetics</strong>! ✨</p>
            </div>
            
            <div class="footer">
              <p><strong>Anjola Aesthetics Ng</strong></p>
              <p>hello@anjolaaestheticsng.com</p>
              <p>&copy; ${new Date().getFullYear()} Anjola Aesthetics Ng. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ Shipped notification sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Shipped email error:', error);
    return { success: false, error: error.message };
  }
};

// Send delivered notification - NOW WITH FULL ORDER DETAILS
exports.sendDeliveredNotification = async (orderData) => {
  try {
    const { customerInfo, orderNumber, items, totalAmount } = orderData;

    const itemsHTML = items && items.length > 0 ? generateCompactItemsHTML(items) : '';

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: customerInfo.email,
      subject: `✅ Order Delivered - #${orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
            .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; }
            .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 50px 30px; text-align: center; }
            .icon { font-size: 80px; margin-bottom: 20px; }
            .content { padding: 40px 30px; }
            .celebration-box { background: linear-gradient(135deg, #fff9e6 0%, #e8f5e9 100%); padding: 30px; text-align: center; border-radius: 12px; margin: 30px 0; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background: #f8f9fa; padding: 12px; text-align: left; }
            td { padding: 12px; border-bottom: 1px solid #eee; }
            .total-box { background: #e8f5e9; padding: 15px 20px; border-radius: 8px; text-align: right; margin-top: 15px; }
            .address-box { background: #f8f9fa; padding: 15px 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #11998e; }
            .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">🎉</div>
              <h1>Your Order Has Been Delivered!</h1>
              <p>Order #${orderNumber}</p>
            </div>
            
            <div class="content">
              <p>Dear <strong>${customerInfo.fullName}</strong>,</p>
              <p>Great news! Your order has been successfully delivered!</p>
              
              <div class="celebration-box">
                <h2 style="margin: 0 0 15px 0; color: #11998e;">✨ Enjoy Your Products! ✨</h2>
                <p style="margin: 0; font-size: 16px;">We hope you love your new items from Anjola Aesthetics Ng!</p>
              </div>
              
              ${items && items.length > 0 ? `
                <h3 style="color: #11998e;">📦 What Was Delivered</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style="text-align: center;">Qty</th>
                      <th style="text-align: right;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHTML}
                  </tbody>
                </table>
                ${totalAmount ? `
                  <div class="total-box">
                    <span style="font-size: 18px; font-weight: bold; color: #11998e;">
                      Total Paid: ₦${totalAmount.toLocaleString()}
                    </span>
                  </div>
                ` : ''}
              ` : ''}
              
              <div class="address-box">
                <p style="margin: 0;"><strong>📍 Delivered To:</strong></p>
                <p style="margin: 8px 0 0 0;">${customerInfo.fullName}</p>
                <p style="margin: 4px 0 0 0;">${customerInfo.address}</p>
                <p style="margin: 4px 0 0 0;">${customerInfo.city}, ${customerInfo.state}</p>
              </div>
              
              <h3 style="color: #11998e;">💬 Share Your Experience</h3>
              <p>We'd love to hear from you! Share your thoughts and tag us on social media:</p>
              <p style="text-align: center; font-size: 24px; margin: 20px 0;">
                📱 Instagram • 👍 Facebook • 🐦 Twitter
              </p>
              
              <p style="margin-top: 30px; padding: 20px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                <strong>💡 Need Help?</strong> If you have any questions or concerns about your order, please don't hesitate to reach out to us!
              </p>
              
              <p style="margin-top: 30px; text-align: center;">Thank you for choosing <strong>Anjola Aesthetics</strong>! We can't wait to serve you again! 💕</p>
            </div>
            
            <div class="footer">
              <p><strong>Anjola Aesthetics Ng</strong></p>
              <p>hello@anjolaaestheticsng.com</p>
              <p>&copy; ${new Date().getFullYear()} Anjola Aesthetics Ng. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ Delivered notification sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Delivered email error:', error);
    return { success: false, error: error.message };
  }
};

// Send cancelled notification - NOW WITH FULL ORDER DETAILS
exports.sendCancelledNotification = async (orderData) => {
  try {
    const { customerInfo, orderNumber, refundInfo, items, totalAmount } = orderData;

    const itemsHTML = items && items.length > 0 ? generateCompactItemsHTML(items) : '';

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: customerInfo.email,
      subject: `❌ Order Cancelled - #${orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
            .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; }
            .header { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); color: white; padding: 50px 30px; text-align: center; }
            .icon { font-size: 80px; margin-bottom: 20px; }
            .content { padding: 40px 30px; }
            .info-box { background: #fff3cd; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #ffc107; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background: #f8f9fa; padding: 12px; text-align: left; }
            td { padding: 12px; border-bottom: 1px solid #eee; }
            .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 13px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="icon">😔</div>
              <h1>Order Cancelled</h1>
              <p>Order #${orderNumber}</p>
            </div>
            
            <div class="content">
              <p>Dear <strong>${customerInfo.fullName}</strong>,</p>
              <p>We're sorry to inform you that your order has been cancelled.</p>
              
              ${refundInfo ? `
                <div class="info-box">
                  <p style="margin: 0;"><strong>💰 Refund Information:</strong></p>
                  <p style="margin: 10px 0 0 0;">${refundInfo}</p>
                </div>
              ` : ''}
              
              ${items && items.length > 0 ? `
                <h3 style="color: #eb3349;">📦 Cancelled Items</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th style="text-align: center;">Qty</th>
                      <th style="text-align: right;">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHTML}
                  </tbody>
                </table>
                ${totalAmount ? `
                  <p style="text-align: right; font-size: 16px; color: #666;">
                    Order Total: <strong>₦${totalAmount.toLocaleString()}</strong>
                  </p>
                ` : ''}
              ` : ''}
              
              <p>If you have any questions about this cancellation, please don't hesitate to contact our customer support team. We're here to help!</p>
              
              <p style="margin-top: 30px;">We hope to see you again soon at <strong>Anjola Aesthetics Ng</strong>! 💕</p>
            </div>
            
            <div class="footer">
              <p><strong>Anjola Aesthetics Ng</strong></p>
              <p>hello@anjolaaestheticsng.com</p>
              <p>&copy; ${new Date().getFullYear()} Anjola Aesthetics Ng. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ Cancelled notification sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Cancelled email error:', error);
    return { success: false, error: error.message };
  }
};

module.exports = exports;