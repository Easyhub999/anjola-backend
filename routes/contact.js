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
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    console.log('📥 Received:', { name, email });

    if (!name || !email || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    console.log('📧 Sending to:', process.env.TARGET_EMAIL);
    console.log('API Key present:', !!process.env.RESEND_API_KEY);
    console.log('API Key first 10 chars:', process.env.RESEND_API_KEY?.substring(0, 10));
    
    const emailData = {
      from: "Anjola Aesthetics <contact@anjolaaestheticsng.com>",
      to: process.env.TARGET_EMAIL, 
      replyTo: email,
      subject: `✨ New Contact Message From ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Message:</strong></p>
          <p>${message}</p>
        </div>
      `
    };

    console.log('Email data prepared:', { ...emailData, html: '[HTML CONTENT]' });

    const data = await resend.emails.send(emailData);

    console.log('✅ Resend response:', JSON.stringify(data, null, 2));

    if (!data || !data.id) {
      throw new Error('Resend returned no email ID - API key may be invalid');
    }

    res.json({ 
      success: true,
      message: "Message sent successfully", 
      emailId: data.id 
    });

  } catch (error) {
    console.error("❌ FULL ERROR:", error);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({ 
      success: false,
      message: error.message || "Error sending message"
    });
  }
});

module.exports = router;