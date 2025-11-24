const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Debug logs
    console.log('📧 Attempting to send email...');
    console.log('From:', "onboarding@resend.dev");
    console.log('To:', process.env.TARGET_EMAIL);
    console.log('API Key exists:', !!process.env.RESEND_API_KEY);

    const data = await resend.emails.send({
      from: "Anjola Aesthetics <onboarding@resend.dev>",  // Changed from no-reply
      to: process.env.TARGET_EMAIL, 
      replyTo: email, // This allows you to reply directly to the customer
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

    console.log('✅ Email sent successfully!');
    console.log('Email ID:', data.id);
    
    res.json({ message: "Message sent successfully", emailId: data.id });

  } catch (error) {
    console.error("❌ Contact form error:", error);
    console.error("Error message:", error.message);
    res.status(500).json({ 
      message: "Error sending message",
      error: process.env.NODE_ENV === 'development' ? error.message : 'Please try again later'
    });
  }
});

module.exports = router;