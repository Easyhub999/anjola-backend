const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// TEST ENDPOINT - Add this first
router.get('/test', async (req, res) => {
  try {
    console.log('=== RESEND TEST ===');
    console.log('Resend object:', typeof resend);
    console.log('Resend.emails:', typeof resend?.emails);
    console.log('API Key exists:', !!process.env.RESEND_API_KEY);
    console.log('API Key length:', process.env.RESEND_API_KEY?.length);
    console.log('Target email:', process.env.TARGET_EMAIL);

    if (!resend || !resend.emails) {
      return res.status(500).json({ 
        success: false, 
        error: 'Resend client not properly initialized'
      });
    }

    console.log('Attempting to send email...');

    const result = await resend.emails.send({
      from: "Anjola Aesthetics <contact@anjolaaestheticsng.com>",
      to: process.env.TARGET_EMAIL,
      subject: "🧪 Test Email from Anjola Aesthetics",
      html: "<h1>Success!</h1><p>If you see this, Resend is working correctly.</p>"
    });

    console.log('Raw Resend result:', JSON.stringify(result, null, 2));

    if (!result) {
      return res.status(500).json({
        success: false,
        error: 'Resend returned null/undefined'
      });
    }

    if (result.error) {
      return res.status(500).json({
        success: false,
        error: result.error.message || 'Unknown Resend error',
        details: result.error
      });
    }

    res.json({ 
      success: true, 
      message: "Test email sent successfully!",
      emailId: result.id || result.data?.id || 'NO_ID_RETURNED',
      fullResult: result,
      to: process.env.TARGET_EMAIL
    });

  } catch (error) {
    console.error("❌ Test failed:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

// ACTUAL CONTACT FORM ENDPOINT
// ACTUAL CONTACT FORM ENDPOINT
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    console.log('📥 Received contact form:', { name, email });

    if (!name || !email || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    console.log('📧 Sending to:', process.env.TARGET_EMAIL);
    
    const result = await resend.emails.send({
      from: "Anjola Aesthetics <contact@anjolaaestheticsng.com>",
      to: process.env.TARGET_EMAIL, 
      replyTo: email,
      subject: `✨ New Contact Message From ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #ec4899;">New Contact Form Submission</h2>
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            <p><strong>Message:</strong></p>
            <p style="white-space: pre-wrap;">${message}</p>
          </div>
        </div>
      `
    });

    console.log('✅ Resend response:', JSON.stringify(result, null, 2));

    if (result.error) {
      return res.status(500).json({
        success: false,
        message: result.error.message || 'Failed to send email',
        error: result.error
      });
    }

    res.json({ 
      success: true,
      message: "Message sent successfully", 
      emailId: result.id || result.data?.id || 'sent'
    });

  } catch (error) {
    console.error("❌ Contact form error:", error);
    
    res.status(500).json({ 
      success: false,
      message: error.message || "Error sending message"
    });
  }
});

module.exports = router;