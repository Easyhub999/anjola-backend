const express = require("express");
const router = express.Router();
const { Resend } = require("resend");

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/contact
router.post("/", async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Send email using Resend
    const result = await resend.emails.send({
      from: process.env.CONTACT_EMAIL,
      to: process.env.TARGET_EMAIL,
      subject: `New Contact Form Message from ${name}`,
      html: `
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, "<br>")}</p>
      `
    });

    console.log("Resend result:", result);
    res.json({ message: "Message sent successfully!" });

  } catch (error) {
    console.error("Resend Error:", error);
    res.status(500).json({ message: "Failed to send email" });
  }
});

module.exports = router;