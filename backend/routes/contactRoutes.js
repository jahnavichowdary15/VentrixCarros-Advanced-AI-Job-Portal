
"use strict";

const express = require("express");
const nodemailer = require("nodemailer");
const { rateLimit } = require("express-rate-limit");

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many messages sent. Please try again later."
  }
});

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

router.post("/", contactLimiter, async (req, res) => {
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254);
  const category = cleanText(req.body?.category, 80);
  const subject = cleanText(req.body?.subject, 180);
  const message = cleanText(req.body?.message, 5000);

  if (!name || !email || !category || !subject || !message) {
    return res.status(400).json({
      success: false,
      message: "Please complete all fields."
    });
  }

  if (!validEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid email address."
    });
  }

  if (
    !process.env.GMAIL_USER ||
    !process.env.GMAIL_APP_PASSWORD
  ) {
    console.error("Contact email configuration is missing.");

    return res.status(500).json({
      success: false,
      message: "Email service is not configured. Please try again later."
    });
  }

  const recipient =
    process.env.CONTACT_TO || process.env.GMAIL_USER;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: `"VentrixCarros Website" <${process.env.GMAIL_USER}>`,
      to: recipient,
      replyTo: {
        name,
        address: email
      },
      subject: `[VentrixCarros Contact] ${subject}`,
      text: [
        "New message from the VentrixCarros contact form",
        "",
        `Name: ${name}`,
        `Email: ${email}`,
        `Category: ${category}`,
        `Subject: ${subject}`,
        "",
        "Message:",
        message
      ].join("\n")
    });

    return res.status(200).json({
      success: true,
      message: "Your message has been sent successfully."
    });
  } catch (error) {
    // Do not log email credentials or message contents.
    console.error("Contact email delivery failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "We could not send your message. Please try again later."
    });
  }
});

module.exports = router;
