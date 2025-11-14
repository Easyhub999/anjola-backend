const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/contact
router.post('/', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const data = await resend.emails.send({
      from: "Anjola Aesthetics <onboarding@resend.dev>",
      to: process.env.TARGET_EMAIL,
      subject: `✨ New Contact Message From ${name}`,
      html: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong><br>${message}</p>
      `
    });

    res.json({ message: "Message sent successfully", data });

  } catch (error) {
    console.error("Contact form error:", error);
    res.status(500).json({ message: "Error sending message" });
  }
});

module.exports = router;