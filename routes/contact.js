const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// TEST ENDPOINT - Add this first
router.get('/test', async (req, res) => {
  try {
    console.log('=== RESEND TEST ===');
    console.log('API Key exists:', !!process.env.RESEND_API_KEY);
    console.log('API Key prefix:', process.env.RESEND_API_KEY?.substring(0, 8));
    console.log('Target email:', process.env.TARGET_EMAIL);

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: 'RESEND_API_KEY not found in environment variables' 
      });
    }

    if (!process.env.TARGET_EMAIL) {
      return res.status(500).json({ 
        success: false, 
        error: 'TARGET_EMAIL not found in environment variables' 
      });
    }

    const data = await resend.emails.send({
      from: "Anjola Aesthetics <onboarding@resend.dev>",
      to: process.env.TARGET_EMAIL,
      subject: "🧪 Test Email from Anjola Aesthetics",
      html: "<h1>Success!</h1><p>If you see this, Resend is working correctly.</p>"
    });

    console.log('✅ Test email sent:', data);
    res.json({ 
      success: true, 
      message: "Test email sent successfully!",
      emailId: data.id,
      to: process.env.TARGET_EMAIL
    });

  } catch (error) {
    console.error("❌ Test failed:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      name: error.name
    });
  }
});

// ACTUAL CONTACT FORM ENDPOINT
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    console.log('📧 Sending contact form email...');
    
    const data = await resend.emails.send({
      from: "Anjola Aesthetics <onboarding@resend.dev>",
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

    console.log('✅ Email sent:', data.id);
    res.json({ message: "Message sent successfully", emailId: data.id });

  } catch (error) {
    console.error("❌ Contact form error:", error);
    res.status(500).json({ 
      message: "Error sending message",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;