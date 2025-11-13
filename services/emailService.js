const { Resend } = require('resend');

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

// Send order confirmation email
exports.sendOrderConfirmation = async (orderData) => {
  try {
    const { customerInfo, items, totalAmount, orderNumber } = orderData;

    // Create items list HTML
    const itemsHTML = items.map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">
          <strong>${item.name}</strong>
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
    `).join('');

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
            .header p {
              margin: 0;
              font-size: 16px;
              opacity: 0.9;
            }
            .content { 
              padding: 40px 30px;
            }
            .content h2 {
              color: #f5576c;
              font-size: 22px;
              margin: 0 0 20px 0;
            }
            .content h3 {
              color: #f5576c;
              font-size: 18px;
              margin: 30px 0 15px 0;
            }
            .greeting {
              font-size: 16px;
              margin-bottom: 20px;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin: 25px 0;
              background: white;
              border-radius: 8px;
              overflow: hidden;
            }
            th {
              background: #f8f9fa;
              padding: 12px;
              text-align: left;
              font-weight: 600;
              color: #555;
              font-size: 14px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .total-row { 
              background: #f8f9fa;
              font-weight: 600;
              font-size: 18px;
            }
            .total-row td {
              padding: 20px 12px !important;
              border-top: 2px solid #f5576c;
            }
            .address-box {
              background: #f8f9fa;
              border-left: 4px solid #f5576c;
              padding: 20px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .address-box p {
              margin: 5px 0;
              line-height: 1.8;
            }
            .button { 
              display: inline-block; 
              padding: 14px 32px; 
              background: #f5576c; 
              color: white !important; 
              text-decoration: none; 
              border-radius: 8px; 
              margin: 25px 0;
              font-weight: 600;
              transition: background 0.3s;
            }
            .button:hover {
              background: #e04557;
            }
            .footer { 
              background: #f8f9fa; 
              padding: 30px; 
              text-align: center;
              font-size: 13px; 
              color: #666;
              line-height: 1.8;
            }
            .footer-links {
              margin: 15px 0;
            }
            .footer-links a {
              color: #f5576c;
              text-decoration: none;
              margin: 0 10px;
            }
            .social-icons {
              margin: 20px 0;
            }
            .social-icons a {
              display: inline-block;
              margin: 0 8px;
              color: #999;
              text-decoration: none;
            }
            @media only screen and (max-width: 600px) {
              .email-container {
                margin: 0;
                border-radius: 0;
              }
              .header, .content, .footer {
                padding: 20px;
              }
              table {
                font-size: 13px;
              }
              th, td {
                padding: 8px !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h1>✨ Thank You for Your Order!</h1>
              <p>Order #${orderNumber}</p>
            </div>
            
            <div class="content">
              <div class="greeting">
                <p>Dear <strong>${customerInfo.fullName}</strong>,</p>
                <p>Thank you for shopping with <strong>Anjola Aesthetics</strong>! Your order has been confirmed and is being processed. We're excited to get your luxury self-care products to you!</p>
              </div>
              
              <h3>📦 Order Summary</h3>
              <table>
                <thead>
                  <tr>
                    <th style="text-align: left;">Product</th>
                    <th style="text-align: center;">Qty</th>
                    <th style="text-align: right;">Price</th>
                    <th style="text-align: right;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHTML}
                  <tr class="total-row">
                    <td colspan="3" style="padding: 20px 12px; text-align: right;">
                      <strong>Total Amount:</strong>
                    </td>
                    <td style="padding: 20px 12px; text-align: right; color: #f5576c;">
                      <strong>₦${totalAmount.toLocaleString()}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <h3>🚚 Shipping Information</h3>
              <div class="address-box">
                <p><strong>${customerInfo.fullName}</strong></p>
                <p>${customerInfo.address}</p>
                <p>${customerInfo.city}, ${customerInfo.state}</p>
                <p>📱 ${customerInfo.phone}</p>
                <p>📧 ${customerInfo.email}</p>
              </div>
              <h3>📬 What's Next?</h3>
              <p>We'll send you another email with tracking information once your order ships. You can expect delivery within <strong>3-5 business days</strong>.</p>
              
              <p style="margin-top: 30px;">If you have any questions about your order, feel free to reply to this email or contact our customer support.</p>
              
              <center>
                <a href="${process.env.FRONTEND_URL}" class="button">Continue Shopping</a>
              </center>
            </div>
            
            <div class="footer">
              <p><strong>Anjola Aesthetics</strong></p>
              <p>Luxury self-care products for the modern woman</p>
              
              <div class="footer-links">
                <a href="${process.env.FRONTEND_URL}/shop">Shop</a> •
                <a href="${process.env.FRONTEND_URL}/contact">Contact Us</a> •
                <a href="${process.env.FRONTEND_URL}/blog">Blog</a>
              </div>
              
              <div class="social-icons">
                <a href="#">📱 Instagram</a>
                <a href="#">👍 Facebook</a>
                <a href="#">🐦 Twitter</a>
              </div>
              
              <p style="margin-top: 20px; color: #999;">
                Lagos, Nigeria<br>
                📧 hello@anjolaaesthetics.com
              </p>
              
              <p style="margin-top: 20px; font-size: 11px; color: #999;">
                &copy; ${new Date().getFullYear()} Anjola Aesthetics. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ Order confirmation email sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Email sending error:', error);
    return { success: false, error: error.message };
  }
};

// Send payment confirmation email
exports.sendPaymentConfirmation = async (orderData) => {
  try {
    const { customerInfo, totalAmount, orderNumber, paymentReference } = orderData;

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: customerInfo.email,
      subject: `💳 Payment Confirmed - Order #${orderNumber}`,
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
              background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%); 
              color: white; 
              padding: 50px 30px; 
              text-align: center;
            }
            .success-icon { 
              font-size: 80px; 
              margin-bottom: 20px;
              animation: scaleIn 0.5s ease-in-out;
            }
            @keyframes scaleIn {
              from { transform: scale(0); }
              to { transform: scale(1); }
            }
            .header h1 {
              margin: 0;
              font-size: 32px;
              font-weight: 600;
            }
            .content { 
              padding: 40px 30px;
            }
            .amount-box {
              background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
              color: white;
              padding: 30px;
              text-align: center;
              border-radius: 12px;
              margin: 30px 0;
            }
            .amount-box .label {
              font-size: 14px;
              opacity: 0.9;
              margin-bottom: 10px;
            }
            .amount-box .amount {
              font-size: 42px;
              font-weight: 700;
              margin: 0;
            }
            .info-box {
              background: #f8f9fa;
              border-left: 4px solid #84fab0;
              padding: 20px;
              margin: 20px 0;
              border-radius: 8px;
            }
            .info-box p {
              margin: 8px 0;
            }
            .footer { 
              background: #f8f9fa; 
              padding: 30px; 
              text-align: center;
              font-size: 13px; 
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <div class="success-icon">✅</div>
              <h1>Payment Successful!</h1>
            </div>
            
            <div class="content">
              <p style="font-size: 16px;">Dear <strong>${customerInfo.fullName}</strong>,</p>
              
              <p>Great news! We've received your payment and it has been confirmed.</p>
              
              <div class="amount-box">
                <div class="label">Amount Paid</div>
                <div class="amount">₦${totalAmount.toLocaleString()}</div>
              </div>
              
              <div class="info-box">
                <p><strong>Order Number:</strong> #${orderNumber}</p>
                <p><strong>Payment Reference:</strong> ${paymentReference}</p>
                <p><strong>Payment Status:</strong> <span style="color: #28a745;">✓ Confirmed</span></p>
              </div>
              
              <h3 style="color: #84fab0; margin-top: 30px;">📦 What Happens Next?</h3>
              <p>Your order is now being prepared for shipment. Our team is carefully packaging your luxury self-care products. You'll receive a shipping confirmation email with tracking information within 24 hours.</p>
              
              <p style="margin-top: 30px; padding: 20px; background: #fff9e6; border-radius: 8px; border-left: 4px solid #ffc107;">
                <strong>💡 Pro Tip:</strong> Save your payment reference number for your records. You can use it to track your payment or contact customer support if needed.
              </p>
              
              <p style="margin-top: 30px; text-align: center;">
                Thank you for choosing <strong>Anjola Aesthetics</strong>! ✨
              </p>
            </div>
            
            <div class="footer">
              <p><strong>Anjola Aesthetics</strong></p>
              <p>Luxury self-care products for the modern woman</p>
              <p style="margin-top: 15px; color: #999;">
                Lagos, Nigeria • hello@anjolaaesthetics.com
              </p>
              <p style="margin-top: 15px; font-size: 11px; color: #999;">
                &copy; ${new Date().getFullYear()} Anjola Aesthetics. All rights reserved.
              </p>
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

// Send order status update email
exports.sendOrderStatusUpdate = async (orderData) => {
  try {
    const { customerInfo, orderNumber, status, trackingNumber } = orderData;

    let statusMessage = '';
    let statusColor = '#f5576c';
    let statusIcon = '📦';

    switch (status) {
      case 'processing':
        statusMessage = 'Your order is being processed';
        statusIcon = '⚙️';
        statusColor = '#ffc107';
        break;
      case 'shipped':
        statusMessage = 'Your order has been shipped!';
        statusIcon = '🚚';
        statusColor = '#17a2b8';
        break;
      case 'delivered':
        statusMessage = 'Your order has been delivered!';
        statusIcon = '✅';
        statusColor = '#28a745';
        break;
      case 'cancelled':
        statusMessage = 'Your order has been cancelled';
        statusIcon = '❌';
        statusColor = '#dc3545';
        break;
      default:
        statusMessage = 'Order status updated';
    }

    const trackingSection = trackingNumber ? `
      <div class="info-box">
        <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
        <p style="font-size: 13px; color: #666;">Use this number to track your package</p>
      </div>
    ` : '';

    const data = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: customerInfo.email,
      subject: `${statusIcon} Order Update - #${orderNumber}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; }
            .header { background: ${statusColor}; color: white; padding: 30px; text-align: center; }
            .content { padding: 30px; }
            .info-box { background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${statusIcon} ${statusMessage}</h1>
            </div>
            <div class="content">
              <p>Dear <strong>${customerInfo.fullName}</strong>,</p>
              <p>Your order <strong>#${orderNumber}</strong> status has been updated.</p>
              ${trackingSection}
              <p>Thank you for shopping with Anjola Aesthetics!</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    console.log('✅ Status update email sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Status email error:', error);
    return { success: false, error: error.message };
  }
};

module.exports = exports;